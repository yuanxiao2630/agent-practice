import { useCallback, useEffect, useRef, useState } from 'react'
import AppHeader from './components/AppHeader.tsx'
import Composer from './components/Composer.tsx'
import TurnView from './components/TurnView.tsx'
import WorkspaceDialog from './components/WorkspaceDialog.tsx'
import { useChat } from './hooks/useChat.ts'
import { useWorkspace } from './hooks/useWorkspace.ts'

const STREAM_PREF_KEY = 'my-agent.stream-output'

/** 默认开启流式；localStorage 不可用时退回默认值，不影响对话 */
function readStreamPreference(): boolean {
    try {
        return window.localStorage.getItem(STREAM_PREF_KEY) !== 'off'
    } catch {
        return true
    }
}

export default function App() {
    const {
        turns,
        busy,
        cancelling,
        status,
        send,
        cancel,
        reset,
        clear: clearChat,
    } = useChat()
    const {
        workspace,
        loading: workspaceLoading,
        choose,
        clear: clearWorkspace,
    } = useWorkspace()

    const [pickerOpen, setPickerOpen] = useState(false)
    const [streamOutput, setStreamOutput] = useState(readStreamPreference)
    const mainRef = useRef<HTMLElement>(null)

    // 记住用户选择：下次打开页面继续沿用，但只在发送那一刻读取
    const updateStreamOutput = useCallback((next: boolean) => {
        setStreamOutput(next)
        try {
            window.localStorage.setItem(STREAM_PREF_KEY, next ? 'on' : 'off')
        } catch {
            /* 隐身模式等禁用 localStorage 的情况，忽略即可 */
        }
    }, [])

    const openPicker = useCallback(() => {
        if (!busy) setPickerOpen(true)
    }, [busy])

    // 切换仓库后服务端已经清空上下文，前端把旧消息一起清掉，避免仓库串台
    const handleChoose = useCallback(
        async (path: string) => {
            const result = await choose(path)
            if (result.reset) clearChat()
        },
        [choose, clearChat],
    )

    const handleClear = useCallback(async () => {
        await clearWorkspace()
        clearChat()
    }, [clearWorkspace, clearChat])

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
            <AppHeader
                status={status}
                busy={busy}
                workspace={workspace}
                workspaceLoading={workspaceLoading}
                streamOutput={streamOutput}
                onToggleStreamOutput={updateStreamOutput}
                onOpenWorkspace={openPicker}
                onReset={reset}
            />

            <main ref={mainRef}>
                <div className="wrap">
                    {workspaceLoading ? (
                        <div className="empty">
                            <p className="muted">正在读取仓库状态…</p>
                        </div>
                    ) : (
                        turns.length === 0 &&
                        (!workspace ? (
                            <div className="empty">
                                <div className="empty-icon" aria-hidden="true">
                                    📁
                                </div>
                                <p className="empty-title">未选择工作区</p>
                                <p className="muted">
                                    可以直接进行普通对话；选择目录后，Agent 才能读取其中的文件。
                                </p>
                                <button
                                    type="button"
                                    className="primary empty-cta"
                                    onClick={openPicker}
                                    disabled={busy}
                                >
                                    ＋ 选择仓库目录
                                </button>
                            </div>
                        ) : (
                            <div className="empty">
                                <p>
                                    正在处理 <strong>{workspace.name}</strong>
                                </p>
                                <p className="workspace-path-line muted" title={workspace.path}>
                                    {workspace.path}
                                </p>
                                <p className="muted">
                                    输入一个问题，Agent 会先调工具查看仓库，再给结论。
                                </p>
                                <p className="muted">
                                    生成过程中可以随时点「停止」或按 Esc 中断；回答下方「查看上下文」能看到完整 messages。
                                </p>
                            </div>
                        ))
                    )}

                    {turns.map((turn) => (
                        <TurnView key={turn.id} turn={turn} />
                    ))}
                </div>
            </main>

            <Composer
                busy={busy}
                cancelling={cancelling}
                hasWorkspace={Boolean(workspace)}
                onPickWorkspace={openPicker}
                onSend={(text) => void send(text, { stream: streamOutput })}
                onCancel={cancel}
            />

            <WorkspaceDialog
                open={pickerOpen}
                busy={busy}
                current={workspace}
                hasConversation={turns.length > 0}
                onClose={() => setPickerOpen(false)}
                onChoose={handleChoose}
                onClear={handleClear}
            />
        </>
    )
}
