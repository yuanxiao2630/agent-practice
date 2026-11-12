import OpenAI from "openai"
import 'dotenv/config'
import { tools } from './workspaceToolSchemas.ts'
import { listWorkspaceEntries, readFileContent, findFunctionLine } from './workspaceTools.ts'

const openai = new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey: process.env['DEEPSEEK_API_KEY'],
})

// 最多允许几轮「模型 -> 工具 -> 模型」，到顶后强制总结作答
export const MAX_ROUNDS = Number(process.env['MAX_ROUNDS'] ?? 10)

const DEBUG = process.env['DEBUG'] === '1'

const MODEL = 'deepseek-flash'

export type ChatMessage = any

export type AgentEvent =
    | { type: 'round'; round: number }
    | { type: 'tool_start'; round: number; name: string; args: unknown }
    | { type: 'tool_end'; round: number; name: string; content: string }
    | { type: 'final'; rounds: number; content: string }
    | { type: 'error'; message: string }

export type Emit = (event: AgentEvent) => void

const SYSTEM_PROMPT = `你是一个简洁、可靠的编程助手。
你可以调用工具查看当前工作区：先看目录，再读文件；不要臆测文件内容，读到什么说什么。
回答用中文，先给结论再给依据，涉及文件时给出路径和行号。`

const FINAL_ANSWER_PROMPT = `已达到最大工具调用轮次（${MAX_ROUNDS} 轮），你不能再调用任何工具。
请直接基于上面已经拿到的工具结果，给用户一个完整、可读的最终回答：
1. 先给结论，再补依据；涉及文件时给出路径和行号；
2. 只使用你确实读到的内容，不要臆测；
3. 如果某个问题因轮次用尽没能查证，明确写出「未能确认」。`

/** 一个空对话（只有 system 提示词） */
export function createMessages(): ChatMessage[] {
    return [{ role: 'system', content: SYSTEM_PROMPT }]
}

/**
 * 跑一轮完整的 agent 循环：用户消息要由调用方先 push 进 messages。
 * 会把 assistant / tool 消息追加进 messages，所以传入的数组就是对话上下文。
 */
export async function runAgent(messages: ChatMessage[], emit: Emit = () => {}): Promise<string> {
    let count = 1

    while (true) {
        // 到达最大轮次：这次请求不传 tools（模型没有任何可调用的函数），
        // 并用一条 system 指令要求它直接总结。用副本追加，不污染 messages 历史。
        if (count > MAX_ROUNDS) {
            const finalCompletion = await openai.chat.completions.create({
                messages: [...messages, { role: "system", content: FINAL_ANSWER_PROMPT }],
                model: MODEL,
                thinking: { "type": "enabled" },
                reasoning_effort: "high",
                stream: false,
            })
            const content = finalCompletion.choices[0].message.content ?? ''
            messages.push({ role: 'assistant', content })
            emit({ type: 'final', rounds: count - 1, content })
            return content
        }

        emit({ type: 'round', round: count })

        const completion = await openai.chat.completions.create({
            messages,
            tools,
            model: MODEL,
            thinking: { "type": "enabled" },
            reasoning_effort: "high",
            stream: false,
        })

        if (DEBUG) console.log(`Round ${count}`, JSON.stringify(completion))

        // message / finish_reason 都在 choices[0] 里，choices 是数组
        const choice = completion.choices[0]
        const message = choice.message
        const finish_reason = choice.finish_reason

        if (finish_reason === 'tool_calls') {
            const toolCalls = message.tool_calls ?? []
            if (toolCalls.length === 0) {
                const content = message.content ?? ''
                messages.push({ role: 'assistant', content })
                emit({ type: 'final', rounds: count, content })
                return content
            }

            // 1. 先把带 tool_calls 的 assistant 消息放回上下文
            messages.push({ role: "assistant", content: message.content ?? "", tool_calls: message.tool_calls })

            for (const item of toolCalls) {
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
                        const args = JSON.parse(item.function.arguments || '{}')
                        const res = await useFun(item.function.name, args)
                        // JSON.stringify(undefined) 会得到 undefined，兜成 "null"
                        content = JSON.stringify(res) ?? 'null'
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
        emit({ type: 'final', rounds: count, content })
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

async function useFun(fun: string, arg: Record<string, any>) {
    switch (fun) {
        case 'listWorkspaceEntries':
            // schema 里该工具没有参数，模型只会传 {}，这里用当前工作目录兜底
            return listWorkspaceEntries(arg.workspaceRoot ?? process.cwd())
        case 'readFileContent':
            return readFileContent(arg.filePath)
        case 'findFunctionLine':
            return findFunctionLine(arg.filePath, arg.funcName)
        default:
            throw new Error(`未知工具: ${fun}`)
    }
}
