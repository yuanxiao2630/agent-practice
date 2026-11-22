import OpenAI from "openai"
import 'dotenv/config'
import { listWorkspaceEntries, readFileContent, findFunctionLine } from './tools/file-tools.ts'
import { searchWeb } from "./tools/index.ts"
import { enabledToolDefinitions, isToolEnabled } from './tools/registry.ts'
import { callMcpTool } from "./mcp/index.ts"
import { getWorkspace, type Workspace } from './workspace.ts'

const openai = new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey: process.env['DEEPSEEK_API_KEY'],
})

export const MAX_ROUNDS = Number(process.env['MAX_ROUNDS'] ?? 10)

// const DEBUG = process.env['DEBUG'] === '1'

const MODEL = 'deepseek-flash'

// DeepSeek 的 thinking / reasoning_effort 是 OpenAI 兼容接口的扩展字段，
// openai SDK 的类型里没有，包一层函数，避免每个调用点都做强转
type DeepSeekChatParams = OpenAI.ChatCompletionCreateParamsNonStreaming & {
    thinking?: { type: 'enabled' | 'disabled' }
    reasoning_effort?: 'low' | 'medium' | 'high'
}

// const ac = new AbortController();
// const signal = ac.signal;

function chat(params: DeepSeekChatParams, signal?: AbortSignal) {
    return openai.chat.completions.create(params, { signal })
}

export type ChatMessage = any

export type AgentEvent =
    | { type: 'round'; round: number, messages: ChatMessage[] }
    | { type: 'tool_start'; round: number; name: string; args: unknown }
    | { type: 'tool_end'; round: number; name: string; content: string }
    | { type: 'final'; rounds: number; content: string; messages: ChatMessage[] }
    | { type: 'aborted'; round: number; reason: string; runId?: string }
    | { type: 'error'; message: string }
    | { type: 'tools', tools: any[] }

export type Emit = (event: AgentEvent) => void

function buildSystemPrompt(workspace: Workspace | null): string {
    const scope = workspace
        ? `用户本次选择的仓库根目录是：${JSON.stringify(workspace.path)}（名称：${JSON.stringify(workspace.name)}）。
所有文件工具都只能访问这个目录；路径一律传相对仓库根的路径，不要传绝对路径，也不要尝试用 ../ 跳出目录。`
        : `当前没有选择工作区目录：你可以正常聊天，但不能读取任何本地文件。
如果用户要求查看/读取本地文件，请照常调用文件工具；工具会返回「还没有选择工作区目录」的错误，把这个错误转告用户，并提醒他点击顶部的「＋ 选择仓库」。`

    return `你是一个简洁、可靠的编程助手。
${scope}
先用 listWorkspaceEntries 看目录，再读文件；不要臆测文件内容，读到什么说什么。
回答用中文，先给结论再给依据，涉及文件时给出路径和行号。`
}

const FINAL_ANSWER_PROMPT = `已达到最大工具调用轮次（${MAX_ROUNDS} 轮），你不能再调用任何工具。
请直接基于上面已经拿到的工具结果，给用户一个完整、可读的最终回答：
1. 先给结论，再补依据；涉及文件时给出路径和行号；
2. 只使用你确实读到的内容，不要臆测；
3. 如果某个问题因轮次用尽没能查证，明确写出「未能确认」。`

export function createMessages(workspace: Workspace | null = getWorkspace()): ChatMessage[] {
    return [{ role: 'system', content: buildSystemPrompt(workspace) }]
}

/** 取消时统一用这个名字，别和真实异常混在一起 */
export function abortError(message = '已中断') {
    const err = new Error(message)
    err.name = 'AbortError'
    return err
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
    while (i >= 0 && msgs[i].role === 'tool') {
        answered.add(msgs[i].tool_call_id)
        i--
    }

    const assistant = msgs[i]
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

/**
 * 跑一轮完整的 agent 循环：用户消息要由调用方先 push 进 messages。
 * 会把 assistant / tool 消息追加进 messages，所以传入的数组就是对话上下文。
 */
export async function runAgent(
    messages: ChatMessage[],
    emit: Emit = () => {},
    signal?: AbortSignal
): Promise<string> {
    let count = 1

    if (signal?.aborted) throw signal.reason ?? abortError()

    // 整个 run 都绑定开始时的仓库：即使中途有人切换目录，工具也不会串到新仓库。
    // 没有选仓库也允许普通对话，文件工具会在执行时返回「未选择工作区」。
    const workspace = getWorkspace()

    // 用户在面板里关掉的工具不发给模型；全部关闭时不传 tools 字段，
    // 避免部分 OpenAI 兼容接口把空数组当成非法参数
    const activeTools = enabledToolDefinitions()
    const toolsParam = activeTools.length > 0 ? { tools: activeTools } : {}

    emit({ type: 'tools', tools: activeTools })

    while (true) {
        if (signal?.aborted) throw signal.reason ?? abortError()

        // 到达最大轮次：这次请求不传 tools（模型没有任何可调用的函数），
        // 并用一条 system 指令要求它直接总结。用副本追加，不污染 messages 历史。
        if (count > MAX_ROUNDS) {
            const finalCompletion = await chat({
                messages: [...messages, { role: "system", content: FINAL_ANSWER_PROMPT }],
                model: MODEL,
                thinking: { "type": "enabled" },
                reasoning_effort: "high",
                stream: false,
            }, signal)
            const content = finalCompletion.choices[0].message.content ?? ''
            messages.push({ role: 'assistant', content })
            emit({ type: 'final', rounds: count - 1, content, messages })
            return content
        }

        emit({ type: 'round', round: count,  messages })

        const completion = await chat({
            messages,
            ...toolsParam,
            model: MODEL,
            thinking: { "type": "enabled" },
            reasoning_effort: "high",
            stream: false,
        }, signal)

        // console.log(`Round ${count}`, JSON.stringify(completion))

        // message / finish_reason 都在 choices[0] 里，choices 是数组
        const choice = completion.choices[0]
        const message = choice.message
        const finish_reason = choice.finish_reason

        if (signal?.aborted) throw signal.reason ?? abortError()

        if (finish_reason === 'tool_calls') {
            const toolCalls = message.tool_calls ?? []
            if (toolCalls.length === 0) {
                const content = message.content ?? ''
                messages.push({ role: 'assistant', content })
                emit({ type: 'final', rounds: count, content, messages })
                return content
            }

            // 1. 先把带 tool_calls 的 assistant 消息放回上下文
            messages.push({ role: "assistant", content: message.content ?? "", tool_calls: message.tool_calls })

            for (const item of toolCalls) {

                if (signal?.aborted) throw signal.reason ?? abortError()

                // 每个 tool_call 都必须回一条 role: 'tool'，且 id 对上；
                // 类型不支持 / 参数解析失败 / 工具抛错都不能跳过，
                // 否则回执数量与 tool_calls 不匹配，下一次请求直接 400
                let content: string
                if (item.type !== 'function') {
                    emit({ type: 'tool_start', round: count, name: `(${item.type})`, args: {} })
                    content = JSON.stringify({ error: `不支持的工具类型: ${item.type}` })
                    emit({ type: 'tool_end', round: count, name: `(${item.type})`, content })
                } else {
                    emit({ type: 'tool_start', round: count, name: item.function.name, args: safeParse(item.function.arguments) })
                    try {
                        // 2. arguments 是 JSON 字符串，必须 parse
                        const args = safeObject(JSON.parse(item.function.arguments || '{}'))
                        const res = await useFun(
                            item.function.name,
                            args,
                            workspace?.path ?? null,
                            signal,
                        )
                        // JSON.stringify(undefined) 会得到 undefined，兜成 "null"
                        content = JSON.stringify(res) ?? 'null'

                        if (signal?.aborted) throw signal.reason ?? abortError()
                    } catch (e) {
                        // 把错误当结果回给模型，让它自己决定重试或换个思路
                        content = JSON.stringify({ error: e instanceof Error ? e.message : String(e) })
                    }
                    emit({ type: 'tool_end', round: count, name: item.function.name, content })
                }
                messages.push({ role: "tool", tool_call_id: item.id, content })
            }
            count++
            continue
        }

        // stop / length / content_filter 等：结束本轮，把模型的话当作最终回答
        const content = message.content ?? ''

        messages.push({ role: 'assistant', content })

        if (finish_reason !== 'stop') console.warn('模型没有调用工具，finish_reason =', finish_reason)

        emit({ type: 'final', rounds: count, content, messages })
        return content
    }
}

function safeParse(raw: string): unknown {
    try {
        return JSON.parse(raw || '{}')
    } catch {
        return raw
    }
}

function safeObject(value: unknown): Record<string, any> {
    return value && typeof value === 'object' ? (value as Record<string, any>) : {}
}

async function useFun(
    fun: string,
    arg: Record<string, any>,
    workspaceRoot: string | null,
    signal?: AbortSignal,
) {
    // 兜底：模型上下文里可能残留上一轮的工具调用，或者别的客户端刚把它关掉
    if (!isToolEnabled(fun)) throw new Error(`工具 ${fun} 已被关闭，请改用其它可用工具或直接回答`)

    switch (fun) {
        case 'listWorkspaceEntries':
            // 只允许列当前仓库内的目录；模型传什么都替换/规整成仓库内路径
            return listWorkspaceEntries(workspaceRoot, typeof arg.path === 'string' ? arg.path : '.')
        case 'readFileContent':
            return readFileContent(workspaceRoot, arg.filePath)
        case 'findFunctionLine':
            return findFunctionLine(workspaceRoot, arg.filePath, arg.funcName)
        case 'searchWeb':
            return searchWeb(arg.query, 5, signal)
        default:
            if (fun.startsWith('maps_')) return callMcpTool(fun, arg, signal)
            throw new Error(`未知工具: ${fun}`)
    }
}
