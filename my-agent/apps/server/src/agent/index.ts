import OpenAI from 'openai'
import { DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, MAX_ROUNDS, MODEL } from '../config/index.ts'
import {
    enabledToolDefinitions,
    findFunctionLine,
    isToolEnabled,
    listWorkspaceEntries,
    readFileContent,
    searchWeb,
    type ToolDefinition,
} from './tools/index.ts'
import { callMcpTool } from '../mcp/index.ts'
import { getWorkspace, type Workspace } from '../util/workspace.ts'
import { buildFinalAnswerPrompt, buildSystemPrompt } from './prompt.ts'
import type { CancelCause, ChatMessage, CompletedReason, Emit } from './types.ts'

export * from './types.ts'

// DeepSeek 的 thinking / reasoning_effort 是 OpenAI 兼容接口的扩展字段，
// openai SDK 的类型里没有，包一层类型，避免每个调用点都做强转
type DeepSeekChatParams = Omit<OpenAI.ChatCompletionCreateParamsStreaming, 'stream'> & {
    thinking?: { type: 'enabled' | 'disabled' }
    reasoning_effort?: 'low' | 'medium' | 'high'
}

// 没配 key 也让服务能起来：模型调用会失败，但页面和工具面板仍然可用，
// 比启动时直接崩掉更好排查
const openai = new OpenAI({
    baseURL: DEEPSEEK_BASE_URL,
    apiKey: DEEPSEEK_API_KEY ?? 'missing-deepseek-api-key',
})

/** 流式请求：模型的每个 token 都会经 SSE 立即推给页面 */
function chatStream(params: DeepSeekChatParams, signal?: AbortSignal) {
    return openai.chat.completions.create({ ...params, stream: true }, { signal })
}

/** 非流式请求：等模型整段生成完再一次性返回 */
function chatOnce(params: DeepSeekChatParams, signal?: AbortSignal) {
    return openai.chat.completions.create({ ...params, stream: false }, { signal })
}

type FunctionToolCall = {
    id: string
    type: 'function'
    function: { name: string; arguments: string }
}

/** 流式的 tool_call 是分片到达的；非流式则直接是完整调用，这里统一形状 */
type ToolCallDraft =
    | FunctionToolCall
    | { id: string; type: 'custom'; custom: { name: string; input: string } }

type CompletionResult = {
    content: string
    finishReason: string
    toolCalls: ToolCallDraft[]
}

/** 非流式响应里的 tool_calls 已经是完整的，只统一类型，不做聚合 */
function normalizeToolCalls(
    calls: NonNullable<OpenAI.ChatCompletionMessage['tool_calls']>,
): ToolCallDraft[] {
    return calls.map((call) =>
        call.type === 'function'
            ? {
                  id: call.id,
                  type: 'function' as const,
                  function: { name: call.function.name, arguments: call.function.arguments },
              }
            : {
                  id: call.id,
                  type: 'custom' as const,
                  custom: { name: call.custom.name, input: call.custom.input },
              },
    )
}

/**
 * 消费一次流式回复：
 * - 文本增量立刻 emit（页面可以边生成边渲染）；
 * - tool_call 的 id / name / arguments 分片在本地拼回完整调用，
 *   保证进入 messages 的仍然是一条合法、完整的 assistant 消息。
 */
async function streamCompletion(
    params: DeepSeekChatParams,
    emit: Emit,
    round: number,
    signal?: AbortSignal,
): Promise<CompletionResult> {
    const stream = await chatStream(params, signal)
    let content = ''
    let finishReason = 'unknown'
    const drafts: FunctionToolCall[] = []

    for await (const chunk of stream) {
        if (signal?.aborted) throw signal.reason ?? abortError()

        const choice = chunk.choices[0]
        if (!choice) continue
        if (choice.finish_reason) finishReason = choice.finish_reason

        const delta = choice.delta
        const piece = delta?.content
        if (piece) {
            content += piece
            await emit({ type: 'model.delta', round, content: piece })
        }

        for (const part of delta?.tool_calls ?? []) {
            const index = part.index ?? drafts.length
            const draft = (drafts[index] ??= {
                id: '',
                type: 'function',
                function: { name: '', arguments: '' },
            })
            if (part.id) draft.id = part.id
            if (part.function?.name) draft.function.name += part.function.name
            if (part.function?.arguments) draft.function.arguments += part.function.arguments
        }
    }

    const toolCalls = drafts.filter((draft) => draft.id || draft.function.name)
    // 个别兼容接口最后一片不带 finish_reason，按实际收到的内容兜底
    if (finishReason === 'unknown' && toolCalls.length > 0) finishReason = 'tool_calls'

    return { content, finishReason, toolCalls }
}

/** 非流式回复：不产生 model.delta，等内容全部到齐后一次返回 */
async function completeOnce(
    params: DeepSeekChatParams,
    signal?: AbortSignal,
): Promise<CompletionResult> {
    const completion = await chatOnce(params, signal)
    const choice = completion.choices[0]
    if (!choice) throw new Error('模型返回了空的 choices')

    return {
        content: choice.message.content ?? '',
        finishReason: choice.finish_reason ?? 'unknown',
        toolCalls: normalizeToolCalls(choice.message.tool_calls ?? []),
    }
}

/** 按调用方选择的模式走流式或非流式，后面的工具循环对两者完全一致 */
function complete(
    params: DeepSeekChatParams,
    emit: Emit,
    round: number,
    signal: AbortSignal | undefined,
    stream: boolean,
): Promise<CompletionResult> {
    return stream
        ? streamCompletion(params, emit, round, signal)
        : completeOnce(params, signal)
}

export function createMessages(workspace: Workspace | null = getWorkspace()): ChatMessage[] {
    return [{ role: 'system', content: buildSystemPrompt(workspace) }]
}

/** 取消时统一用这个名字，别和真实异常混在一起；cause 用来区分谁取消的 */
export function abortError(message = '已中断', cause: CancelCause = 'user') {
    const err = new Error(message) as Error & { abortCause?: CancelCause }
    err.name = 'AbortError'
    err.abortCause = cause
    return err
}

/** 从 AbortController 的 reason 里取取消来源；拿不到时按用户取消处理 */
export function abortCauseOf(err: unknown): CancelCause {
    const e = err as { abortCause?: CancelCause } | null
    return e?.abortCause ?? 'user'
}

export function isAbortError(err: unknown, signal?: AbortSignal): boolean {
    if (signal?.aborted) return true
    const e = err as { name?: string; code?: string } | null
    return e?.name === 'AbortError' || e?.code === 'ABORT_ERR'
}

/**
 * 「封口」：给有 tool_calls 但缺回执的尾巴补一条 error，而不是删记录。
 * 现场全留着（排查要看），补完后 messages 又是合法上下文（下一次请求不会 400）。
 * 返回是否真的补了；已经是完整批次时是 no-op。
 */
export function sealToolCalls(msgs: ChatMessage[], reason: string): boolean {
    // 从尾部往前：先收集已经写入的 tool 回执，再找到它们所属的 assistant
    const answered = new Set<string>()
    let i = msgs.length - 1
    while (i >= 0) {
        const m = msgs[i]
        if (m.role !== 'tool') break
        answered.add(m.tool_call_id)
        i--
    }

    const assistant = i >= 0 ? msgs[i] : undefined
    if (!assistant || assistant.role !== 'assistant' || !assistant.tool_calls?.length) return false

    let sealed = false
    for (const call of assistant.tool_calls) {
        if (answered.has(call.id)) continue
        msgs.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ error: reason }),
        })
        sealed = true
    }
    return sealed
}

/** runAgent 的返回值：路由层用它发 task.completed，不再由 agent 自己发终止事件 */
export type AgentResult = {
    content: string
    rounds: number
    reason: CompletedReason
}

/**
 * 跑一轮完整的 agent 循环：用户消息要由调用方先 push 进 messages。
 * 会把 assistant / tool 消息追加进 messages，所以传入的数组就是对话上下文。
 */
export async function runAgent(
    messages: ChatMessage[],
    emit: Emit = () => {},
    signal?: AbortSignal,
    activeTools: ToolDefinition[] = enabledToolDefinitions(),
    stream = true,
): Promise<AgentResult> {
    let count = 1
    let modelCalls = 0

    if (signal?.aborted) throw signal.reason ?? abortError()

    // 整个 run 都绑定开始时的仓库：即使中途有人切换目录，工具也不会串到新仓库。
    // 没有选仓库也允许普通对话，文件工具会在执行时返回「未选择工作区」。
    const workspace = getWorkspace()

    // 用户在面板里关掉的工具不发给模型；全部关闭时不传 tools 字段，
    // 避免部分 OpenAI 兼容接口把空数组当成非法参数。
    // tools 由路由层算一次后传进来，保证 task.start 和实际请求的是同一份。
    const toolsParam = activeTools.length > 0 ? { tools: activeTools } : {}

    while (true) {
        if (signal?.aborted) throw signal.reason ?? abortError()

        // 到达最大轮次：这次请求不传 tools（模型没有任何可调用的函数），
        // 并用一条 system 指令要求它直接总结。用副本追加，不污染 messages 历史。
        if (count > MAX_ROUNDS) {
            const summaryMessages: ChatMessage[] = [
                ...messages,
                { role: 'system' as const, content: buildFinalAnswerPrompt(MAX_ROUNDS) },
            ]

            await emit({ type: 'model.start', round: count, messages: summaryMessages })
            if (signal?.aborted) throw signal.reason ?? abortError()
            modelCalls++
            const startedAt = Date.now()

            const { content, finishReason } = await complete(
                {
                    messages: summaryMessages,
                    model: MODEL,
                    thinking: { type: 'enabled' },
                    reasoning_effort: 'high',
                },
                emit,
                count,
                signal,
                stream,
            )
            if (signal?.aborted) throw signal.reason ?? abortError()

            messages.push({ role: 'assistant', content })
            await emit({
                type: 'model.end',
                round: count,
                finishReason,
                content,
                toolCallCount: 0,
                durationMs: Date.now() - startedAt,
            })

            return { content, rounds: modelCalls, reason: 'max_rounds' }
        }

        await emit({ type: 'model.start', round: count, messages })
        if (signal?.aborted) throw signal.reason ?? abortError()
        modelCalls++
        const startedAt = Date.now()

        const { content: modelContent, finishReason, toolCalls } = await complete(
            {
                messages,
                ...toolsParam,
                model: MODEL,
                thinking: { type: 'enabled' },
                reasoning_effort: 'high',
            },
            emit,
            count,
            signal,
            stream,
        )

        if (signal?.aborted) throw signal.reason ?? abortError()

        // 先提交模型回复，再报告 model.end；checkpoint 才能记录待执行工具。
        messages.push({
            role: 'assistant',
            content: modelContent,
            ...(finishReason === 'tool_calls' && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        })
        await emit({
            type: 'model.end',
            round: count,
            finishReason,
            content: modelContent,
            toolCallCount: toolCalls.length,
            durationMs: Date.now() - startedAt,
        })

        if (finishReason === 'tool_calls') {
            if (toolCalls.length === 0) {
                return { content: modelContent, rounds: modelCalls, reason: 'empty_tool_calls' }
            }

            for (const item of toolCalls) {
                if (signal?.aborted) throw signal.reason ?? abortError()

                // 每个 tool_call 都必须回一条 role: 'tool'，且 id 对上；
                // 类型不支持 / 参数解析失败 / 工具抛错都不能跳过，
                // 否则回执数量与 tool_calls 不匹配，下一次请求直接 400
                const toolCallId = item.id
                const toolName = item.type === 'function' ? item.function.name : item.custom.name
                const args = safeParse(
                    item.type === 'function' ? item.function.arguments : item.custom.input,
                )
                await emit({ type: 'tool.start', round: count, toolCallId, name: toolName, args })
                if (signal?.aborted) throw signal.reason ?? abortError()

                const toolStartedAt = Date.now()
                let content: string
                let status: 'done' | 'failed' | 'cancelled' = 'done'
                let error: string | undefined

                if (item.type !== 'function') {
                    error = `不支持的工具类型: ${item.type}`
                    content = JSON.stringify({ error })
                    status = 'failed'
                } else {
                    try {
                        // 2. arguments 是 JSON 字符串，必须 parse
                        const argsObject = safeObject(JSON.parse(item.function.arguments || '{}'))
                        const res = await useFun(
                            item.function.name,
                            argsObject,
                            workspace?.path ?? null,
                            signal,
                        )
                        // JSON.stringify(undefined) 会得到 undefined，兜成 "null"
                        content = JSON.stringify(res) ?? 'null'

                        if (signal?.aborted) throw signal.reason ?? abortError()
                    } catch (e) {
                        // 把错误当结果回给模型，让它自己决定重试或换个思路；
                        // 中断和真实失败要分开，UI 的 StepStatus 直接用这个状态
                        error = e instanceof Error ? e.message : String(e)
                        content = JSON.stringify({ error })
                        status = isAbortError(e, signal) ? 'cancelled' : 'failed'
                    }
                }

                // 工具回执先进入上下文，持久化成功后才能开始下一个工具。
                messages.push({ role: 'tool', tool_call_id: item.id, content })
                await emit({
                    type: 'tool.end',
                    round: count,
                    toolCallId,
                    name: toolName,
                    status,
                    content,
                    error,
                    durationMs: Date.now() - toolStartedAt,
                })
            }
            count++
            continue
        }

        // stop / length / content_filter 等：结束本轮，把模型的话当作最终回答
        const content = modelContent

        if (finishReason !== 'stop') console.warn('模型没有调用工具，finish_reason =', finishReason)

        return {
            content,
            rounds: modelCalls,
            reason: finishReason === 'stop' ? 'stop' : 'other',
        }
    }
}

function safeParse(raw: string): unknown {
    try {
        return JSON.parse(raw || '{}')
    } catch {
        return raw
    }
}

function safeObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/** 模型偶尔会把该给字符串的参数给成数字/对象，这里统一收口成明确的错误 */
function requireString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`参数 ${field} 必须是非空字符串`)
    return value
}

async function useFun(
    fun: string,
    arg: Record<string, unknown>,
    workspaceRoot: string | null,
    signal?: AbortSignal,
) {
    // 兜底：模型上下文里可能残留上一轮的工具调用，或者别的客户端刚把它关掉
    if (!isToolEnabled(fun)) throw new Error(`工具 ${fun} 已被关闭，请改用其它可用工具或直接回答`)

    switch (fun) {
        case 'listWorkspaceEntries':
            // 只允许列当前仓库内的目录；模型传什么都替换/规整成仓库内路径
            return listWorkspaceEntries(
                workspaceRoot,
                typeof arg['path'] === 'string' ? arg['path'] : '.',
            )
        case 'readFileContent':
            return readFileContent(workspaceRoot, requireString(arg['filePath'], 'filePath'))
        case 'findFunctionLine':
            return findFunctionLine(
                workspaceRoot,
                requireString(arg['filePath'], 'filePath'),
                requireString(arg['funcName'], 'funcName'),
            )
        case 'searchWeb':
            return searchWeb(requireString(arg['query'], 'query'), 5, signal)
        default:
            if (fun.startsWith('maps_')) return callMcpTool(fun, arg, signal)
            throw new Error(`未知工具: ${fun}`)
    }
}
