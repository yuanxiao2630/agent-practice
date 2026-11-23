import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchHistory, resetContext, streamChat, cancelChat } from '../api/chat.ts'
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
            // 上一问还没答案就又开了一问：说明上一问被中断/报错了，标出来
            const prev = turns[turns.length - 1]
            if (prev && !prev.assistant) {
                prev.cancelled = true
                prev.cancelReason = '上次中断'
            }
            turns.push({ id: ++seq, user: m.content ?? '', steps: [], snapshots: [] })
        } else if (m.role === 'assistant' && m.content) {
            const last = turns[turns.length - 1]
            if (last && !last.assistant) last.assistant = m.content
            else turns.push({ id: ++seq, user: '', steps: [], assistant: m.content, snapshots: [] })
        }
    }
    return turns
}

/** 中断后的统一收敛：挂起的步骤标记成 cancelled，并记下原因 */
function markCancelled(turn: Turn, reason?: string): Turn {
    if (turn.cancelled && (!reason || turn.cancelReason === reason)) return turn
    return {
        ...turn,
        cancelled: true,
        cancelReason: reason ?? turn.cancelReason,
        steps: turn.steps.map((s) =>
            s.status === 'pending' ? { ...s, status: 'cancelled' as const, note: '已中断' } : s,
        ),
    }
}

export function useChat() {
    const [turns, setTurns] = useState<Turn[]>([])
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState(EMPTY)

    const seq = useRef(0)
    const busyRef = useRef(false) // 给并发判断用，state 在同一个 tick 里还没更新
    const abortRef = useRef<AbortController | null>(null)
    // 切换仓库/清空上下文后，可能在途的 history 请求不能再把旧消息写回来
    const historyIgnored = useRef(false)

    const [cancelling, setCancelling] = useState(false)
    const forceAbortTimer = useRef<number | undefined>(undefined)

    const patchTurn = useCallback((id: number, patch: (turn: Turn) => Turn) => {
        setTurns((prev) => prev.map((t) => (t.id === id ? patch(t) : t)))
    }, [])

    // 打开页面时恢复服务端已有的上下文
    useEffect(() => {
        let alive = true
        fetchHistory()
            .then(({ messages, interrupted }) => {
                if (!alive || historyIgnored.current) return
                const restored = toTurns(messages)
                // 刷新后也能看出「上一问被中断了」，而不是只看到一条没人回答的提问
                const last = restored[restored.length - 1]
                if (interrupted && last) {
                    last.cancelled = true
                    last.cancelReason = '上次中断'
                }
                setTurns(restored)
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
                            case 'task.start':
                                setStatus('准备中…')
                                break

                            case 'model.start':
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

                            case 'model.end':
                                setStatus(
                                    event.toolCallCount > 0 ? '执行工具…' : '整理回答…',
                                )
                                break

                            case 'tool.start': {
                                const step: Step = {
                                    id: event.toolCallId,
                                    name: event.name,
                                    argsText: compact(event.args),
                                    status: 'pending',
                                    note: '',
                                }
                                patchTurn(id, (t) =>
                                    t.steps.some((s) => s.id === step.id)
                                        ? t
                                        : { ...t, steps: [...t.steps, step] },
                                )
                                break
                            }

                            case 'tool.end':
                                patchTurn(id, (t) => {
                                    const idx = t.steps.findIndex(
                                        (s) => s.id === event.toolCallId,
                                    )
                                    if (idx < 0) return t

                                    const steps = t.steps.slice()
                                    steps[idx] = {
                                        ...steps[idx]!,
                                        status: event.status,
                                        note:
                                            event.status === 'done'
                                                ? `返回 ${event.content.length} 字符`
                                                : event.status === 'cancelled'
                                                  ? '已中断'
                                                  : compact(event.error ?? event.content),
                                    }
                                    return { ...t, steps }
                                })
                                break

                            case 'task.completed':
                                patchTurn(id, (t) => ({
                                    ...t,
                                    assistant: event.content || '（模型没有返回内容）',
                                    finalMessages: event.messages,
                                }))
                                setStatus(EMPTY)
                                break

                            case 'task.cancelled':
                                patchTurn(id, (t) => markCancelled(t, event.reason))
                                setStatus('已中断')
                                break

                            case 'task.failed':
                                patchTurn(id, (t) => ({
                                    ...t,
                                    error: event.error,
                                    steps: t.steps.map((s) =>
                                        s.status === 'pending'
                                            ? { ...s, status: 'failed' as const, note: '未完成' }
                                            : s,
                                    ),
                                }))
                                setStatus('出错')
                                break

                            default:
                                break
                        }
                    },
                    controller.signal,
                )
            } catch (err) {
                if (controller.signal.aborted) {
                    // 本地先断开了，可能没收到 aborted 事件，也要标记
                    patchTurn(id, (t) => markCancelled(t))
                    setStatus('已中断')
                } else {
                    const message = err instanceof Error ? err.message : String(err)
                    patchTurn(id, (t) => ({ ...t, error: message }))
                    setStatus('出错')
                }
            } finally {
                window.clearTimeout(forceAbortTimer.current)
                setCancelling(false)
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
        historyIgnored.current = true
        await resetContext().catch(() => {})
        setTurns([])
        setStatus(EMPTY)
    }, [])

    /**
     * 只清本地消息，不再请求 /api/reset。
     * 用于切换/取消仓库：服务端已经重置过上下文，前端跟着清空即可。
     */
    const clear = useCallback(() => {
        historyIgnored.current = true
        setTurns([])
        setStatus(EMPTY)
    }, [])

    const cancel = useCallback(async () => {
        if (!busyRef.current || !abortRef.current || cancelling) return
        setCancelling(true)
        setStatus('正在停止…')

        // 兜底：3s 内服务端还没关流（工具不响应 signal），本地直接断开
        forceAbortTimer.current = window.setTimeout(() => abortRef.current?.abort(), 3000)

        try {
            await cancelChat()
        } catch {
            abortRef.current?.abort()   // 接口失败也别让 UI 卡死
        }
    }, [cancelling])

    return { turns, busy, cancelling, status, send, reset, cancel, clear }
}
