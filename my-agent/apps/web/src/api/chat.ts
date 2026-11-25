import type { AgentEvent, ChatMessage } from '../types.ts'

export type ChatStreamOptions = {
    /** true：逐 token 接收 model.delta；false：等模型整段返回 */
    stream: boolean
}

/** SSE 解析完全沿用原来 public/index.html 里的逻辑，只把「渲染」换成「回调」 */
export async function streamChat(
    message: string,
    options: ChatStreamOptions,
    onEvent: (event: AgentEvent) => void,
    signal?: AbortSignal,
): Promise<void> {
    const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, stream: options.stream }),
        signal,
    })

    if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
    }
    if (!res.body) throw new Error('响应没有 body，无法读取流')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''

    while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })

        let idx: number
        while ((idx = buf.indexOf('\n\n')) >= 0) {
            const raw = buf.slice(0, idx).trim()
            buf = buf.slice(idx + 2)
            if (!raw.startsWith('data:')) continue
            const payload = raw.slice(5).trim()
            if (payload === '[DONE]') continue
            try {
                onEvent(JSON.parse(payload) as AgentEvent)
            } catch {
                // 忽略异常行，不要让一行坏数据打断整条流
            }
        }
    }
}

export type HistoryPayload = {
    sessionId?: string
    messages: ChatMessage[]
    /** 最后一问没有答案：被中断、报错，或服务端已经忘了这轮 */
    interrupted: boolean
}

export async function fetchHistory(): Promise<HistoryPayload> {
    const res = await fetch('/api/history')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return {
        sessionId: typeof data.sessionId === 'string' ? data.sessionId : undefined,
        messages: (data.messages ?? []) as ChatMessage[],
        interrupted: Boolean(data.interrupted),
    }
}

export async function resetContext(): Promise<void> {
    await fetch('/api/reset', { method: 'POST' })
}

export async function cancelChat(): Promise<boolean> {
    const res = await fetch('/api/chat/cancel', { method: 'POST' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json().catch(() => ({}))
    return Boolean(data.cancelled)
}