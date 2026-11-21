import { useEffect, useRef, useState } from 'react'
import AppHeader from './components/AppHeader.tsx'
import Composer from './components/Composer.tsx'
import RoomView from './components/RoomView.tsx'
import TurnView from './components/TurnView.tsx'
import { useChat } from './hooks/useChat.ts'

export type ViewMode = 'chat' | 'rooms'

export default function App() {
    const { turns, busy, status, send, reset } = useChat()
    const [view, setView] = useState<ViewMode>('chat')
    const mainRef = useRef<HTMLElement>(null)

    // 新消息、工具步骤、流式事件都会让 turns 变化，统一滚到底部
    useEffect(() => {
        const el = mainRef.current
        if (el) el.scrollTop = el.scrollHeight
    }, [turns])

    return (
        <>
            <AppHeader status={status} busy={busy} onReset={reset} view={view} onViewChange={setView} />

            {view === 'rooms' ? (
                <RoomView />
            ) : (
                <>
                    <main ref={mainRef}>
                        <div className="wrap">
                            {turns.length === 0 && (
                                <div className="empty">
                                    <p>输入一个问题，Agent 会先调工具查看仓库，再给结论。</p>
                                    <p className="muted">回答过长可折叠；回答下方「查看上下文」能看到发给模型的完整 messages。</p>
                                </div>
                            )}

                            {turns.map((turn) => (
                                <TurnView key={turn.id} turn={turn} />
                            ))}
                        </div>
                    </main>

                    <Composer disabled={busy} onSend={send} />
                </>
            )}
        </>
    )
}
