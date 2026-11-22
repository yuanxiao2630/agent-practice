import { useEffect, useRef } from 'react'
import AppHeader from './components/AppHeader.tsx'
import Composer from './components/Composer.tsx'
import TurnView from './components/TurnView.tsx'
import { useChat } from './hooks/useChat.ts'

export default function App() {
    const { turns, busy, cancelling, status, send, cancel, reset } = useChat()
    const mainRef = useRef<HTMLElement>(null)

    // 新消息、工具步骤、流式事件都会让 turns 变化，统一滚到底部
    useEffect(() => {
        const el = mainRef.current
        if (el) el.scrollTop = el.scrollHeight
    }, [turns])

    // Esc 在页面任意位置都能中断，不用先点回输入框
    useEffect(() => {
        if (!busy) return
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return
            e.preventDefault()
            void cancel()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [busy, cancel])

    return (
        <>
            <AppHeader status={status} busy={busy} onReset={reset} />

            <main ref={mainRef}>
                <div className="wrap">
                    {turns.length === 0 && (
                        <div className="empty">
                            <p>输入一个问题，Agent 会先调工具查看仓库，再给结论。</p>
                            <p className="muted">
                                生成过程中可以随时点「停止」或按 Esc 中断；回答下方「查看上下文」能看到完整 messages。
                            </p>
                        </div>
                    )}

                    {turns.map((turn) => (
                        <TurnView key={turn.id} turn={turn} busy={busy} onRetry={send} />
                    ))}
                </div>
            </main>

            <Composer busy={busy} cancelling={cancelling} onSend={send} onCancel={cancel} />
        </>
    )
}
