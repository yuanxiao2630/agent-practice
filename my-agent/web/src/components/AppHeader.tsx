import ToolPanel from './ToolPanel.tsx'
import type { ViewMode } from '../App.tsx'

export default function AppHeader({
    status,
    busy,
    onReset,
    view,
    onViewChange,
}: {
    status: string
    busy: boolean
    onReset: () => void
    view: ViewMode
    onViewChange: (view: ViewMode) => void
}) {
    return (
        <header className="app-header">
            <h1>迷你 Agent 控制台</h1>
            <span className={`status ${busy ? 'busy' : ''}`}>{status}</span>
            <span className="spacer" />

            {/* 聊天 / 房间 切换：房间是局域网多人聊天室，聊天是单人 agent 对话 */}
            <div className="view-switch">
                <button
                    type="button"
                    className={view === 'chat' ? 'active' : ''}
                    onClick={() => onViewChange('chat')}
                >
                    聊天
                </button>
                <button
                    type="button"
                    className={view === 'rooms' ? 'active' : ''}
                    onClick={() => onViewChange('rooms')}
                >
                    房间
                </button>
            </div>

            <ToolPanel busy={busy} />
            <button type="button" onClick={onReset} disabled={busy}>
                清空上下文
            </button>
        </header>
    )
}
