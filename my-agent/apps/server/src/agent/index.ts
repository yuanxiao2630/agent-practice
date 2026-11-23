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
// openai SDK 的类型里没有，包一层函数，避免每个调用点都做强转
type DeepSeekChatParams = OpenAI.ChatCompletionCreateParamsNonStreaming & {
    thinking?: { type: 'enabled' | 'disabled' }
    reasoning_effort?: 'low' | 'medium' | 'high'
}

// 没配 key 也让服务能起来：模型调用会失败，但页面和工具面板仍然可用，
// 比启动时直接崩掉更好排查
const openai = new OpenAI({
    baseURL: DEEPSEEK_BASE_URL,
    apiKey: DEEPSEEK_API_KEY ?? 'missing-deepseek-api-key',
})

function chat(params: DeepSeekChatParams, signal?: AbortSignal) {
    return openai.chat.completions.create(params, { signal })
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

            emit({ type: 'model.start', round: count, messages: summaryMessages })
            modelCalls++
            const startedAt = Date.now()

            const finalCompletion = await chat(
                {
                    messages: summaryMessages,
                    model: MODEL,
                    thinking: { type: 'enabled' },
                    reasoning_effort: 'high',
                    stream: false,
                },
                signal,
            )

            const choice = finalCompletion.choices[0]
            if (!choice) throw new Error('模型返回了空的 choices')
            if (signal?.aborted) throw signal.reason ?? abortError()

            const content = choice.message.content ?? ''
            emit({
                type: 'model.end',
                round: count,
                finishReason: choice.finish_reason ?? 'unknown',
                content,
                toolCallCount: 0,
                durationMs: Date.now() - startedAt,
            })

            messages.push({ role: 'assistant', content })
            return { content, rounds: modelCalls, reason: 'max_rounds' }
        }

        emit({ type: 'model.start', round: count, messages })
        modelCalls++
        const startedAt = Date.now()

        const completion = await chat(
            {
                messages,
                ...toolsParam,
                model: MODEL,
                thinking: { type: 'enabled' },
                reasoning_effort: 'high',
                stream: false,
            },
            signal,
        )

        // message / finish_reason 都在 choices[0] 里，choices 是数组
        const choice = completion.choices[0]
        if (!choice) throw new Error('模型返回了空的 choices')

        const message = choice.message
        const finishReason = choice.finish_reason ?? 'unknown'

        if (signal?.aborted) throw signal.reason ?? abortError()

        const toolCalls = message.tool_calls ?? []
        emit({
            type: 'model.end',
            round: count,
            finishReason,
            content: message.content ?? '',
            toolCallCount: toolCalls.length,
            durationMs: Date.now() - startedAt,
        })

        if (finishReason === 'tool_calls') {
            if (toolCalls.length === 0) {
                const content = message.content ?? ''
                messages.push({ role: 'assistant', content })
                return { content, rounds: modelCalls, reason: 'empty_tool_calls' }
            }

            // 1. 先把带 tool_calls 的 assistant 消息放回上下文
            messages.push({
                role: 'assistant',
                content: message.content ?? '',
                tool_calls: message.tool_calls,
            })

            for (const item of toolCalls) {
                if (signal?.aborted) throw signal.reason ?? abortError()

                // 每个 tool_call 都必须回一条 role: 'tool'，且 id 对上；
                // 类型不支持 / 参数解析失败 / 工具抛错都不能跳过，
                // 否则回执数量与 tool_calls 不匹配，下一次请求直接 400
                const toolCallId = item.id
                const toolName = item.type === 'function' ? item.function.name : `(${item.type})`
                const args = item.type === 'function' ? safeParse(item.function.arguments) : {}
                emit({ type: 'tool.start', round: count, toolCallId, name: toolName, args })

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

                emit({
                    type: 'tool.end',
                    round: count,
                    toolCallId,
                    name: toolName,
                    status,
                    content,
                    error,
                    durationMs: Date.now() - toolStartedAt,
                })
                messages.push({ role: 'tool', tool_call_id: item.id, content })
            }
            count++
            continue
        }

        // stop / length / content_filter 等：结束本轮，把模型的话当作最终回答
        const content = message.content ?? ''

        messages.push({ role: 'assistant', content })

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
