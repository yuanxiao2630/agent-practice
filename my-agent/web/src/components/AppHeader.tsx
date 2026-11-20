import ToolPanel from './ToolPanel.tsx'

export default function AppHeader({
    status,
    busy,
    onReset,
}: {
    status: string
    busy: boolean
    onReset: () => void
}) {
    return (
        <header className="app-header">
            <h1>迷你 Agent 控制台</h1>
            <span className={`status ${busy ? 'busy' : ''}`}>{status}</span>
            <span className="spacer" />
            <ToolPanel busy={busy} />
            <button type="button" onClick={onReset} disabled={busy}>
                清空上下文
            </button>
        </header>
    )
}
