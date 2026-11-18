import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchHistory, resetContext, streamChat } from '../api/chat.ts'
import type { ChatMessage, Step, Turn } from '../types.ts'

const EMPTY = '就绪'

function compact(value: unknown): string {
    let s: string
    try {
        s = typeof value === 'string' ? value : JSON.stringify(value)
    } catch {
        s = String(value)
    }
    if (!s) s = ''
    return s.length > 90 ? s.slice(0, 90) + '…' : s
}

/** 把 /api/history 的扁平消息列表还原成「一问一答」的 turn 列表 */
function toTurns(messages: ChatMessage[]): Turn[] {
    const turns: Turn[] = []
    let seq = 0
    for (const m of messages) {
        if (m.role === 'user') {
            turns.push({ id: ++seq, user: m.content ?? '', steps: [], snapshots: [] })
        } else if (m.role === 'assistant' && m.content) {
            const last = turns[turns.length - 1]
            if (last && !last.assistant) last.assistant = m.content
            else turns.push({ id: ++seq, user: '', steps: [], assistant: m.content, snapshots: [] })
        }
    }
    return turns
}

export function useChat() {
    const [turns, setTurns] = useState<Turn[]>([])
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState(EMPTY)

    const seq = useRef(0)
    const busyRef = useRef(false) // 给并发判断用，state 在同一个 tick 里还没更新
    const abortRef = useRef<AbortController | null>(null)

    const patchTurn = useCallback((id: number, patch: (turn: Turn) => Turn) => {
        setTurns((prev) => prev.map((t) => (t.id === id ? patch(t) : t)))
    }, [])

    // 打开页面时恢复服务端已有的上下文
    useEffect(() => {
        let alive = true
        fetchHistory()
            .then((messages) => {
                if (alive) setTurns(toTurns(messages))
            })
            .catch(() => {
                /* 首次启动时后端可能还没起来，忽略即可 */
            })
        return () => {
            alive = false
            abortRef.current?.abort()
        }
    }, [])

    const send = useCallback(
        async (text: string) => {
            const content = text.trim()
            if (!content || busyRef.current) return

            const id = ++seq.current
            busyRef.current = true
            setBusy(true)
            setStatus('思考中…')

            setTurns((prev) => [...prev, { id, user: content, steps: [], snapshots: [] }])

            const controller = new AbortController()
            abortRef.current = controller

            try {
                await streamChat(
                    content,
                    (event) => {
                        switch (event.type) {
                            case 'round':
                                setStatus(`第 ${event.round} 轮`)
                                patchTurn(id, (t) => ({
                                    ...t,
                                    // 同一轮可能重发，按 round 覆盖而不是无限追加
                                    snapshots: [
                                        ...t.snapshots.filter((s) => s.round !== event.round),
                                        { round: event.round, messages: event.messages },
                                    ].sort((a, b) => a.round - b.round),
                                }))
                                break

                            case 'tool_start': {
                                const step: Step = {
                                    id: `${event.round}-${event.name}-${Date.now()}-${Math.random()
                                        .toString(36)
                                        .slice(2, 7)}`,
                                    name: event.name,
                                    argsText: compact(event.args),
                                    status: 'pending',
                                    note: '',
                                }
                                patchTurn(id, (t) => ({ ...t, steps: [...t.steps, step] }))
                                break
                            }

                            case 'tool_end':
                                patchTurn(id, (t) => {
                                    const idx = t.steps.findIndex(
                                        (s) => s.status === 'pending' && s.name === event.name,
                                    )
                                    if (idx < 0) return t
                                    const ok = !event.content.startsWith('{"error"')
                                    const steps = t.steps.slice()
                                    steps[idx] = {
                                        ...steps[idx]!,
                                        status: ok ? 'done' : 'failed',
                                        note: ok ? `返回 ${event.content.length} 字符` : compact(event.content),
                                    }
                                    return { ...t, steps }
                                })
                                break

                            case 'final':
                                patchTurn(id, (t) => ({
                                    ...t,
                                    assistant: event.content || '（模型没有返回内容）',
                                    finalMessages:
                                        event.messages ??
                                        t.snapshots[t.snapshots.length - 1]?.messages,
                                }))
                                setStatus(EMPTY)
                                break

                            case 'error':
                                patchTurn(id, (t) => ({ ...t, error: event.message }))
                                setStatus('出错')
                                break
                        }
                    },
                    controller.signal,
                )
            } catch (err) {
                if (!controller.signal.aborted) {
                    const message = err instanceof Error ? err.message : String(err)
                    patchTurn(id, (t) => ({ ...t, error: message }))
                    setStatus('出错')
                }
            } finally {
                busyRef.current = false
                abortRef.current = null
                setBusy(false)
                setStatus((s) => (s === '思考中…' || s === EMPTY ? EMPTY : s))
            }
        },
        [patchTurn],
    )

    const reset = useCallback(async () => {
        if (busyRef.current) return
        await resetContext().catch(() => {})
        setTurns([])
        setStatus(EMPTY)
    }, [])

    return { turns, busy, status, send, reset }
}
