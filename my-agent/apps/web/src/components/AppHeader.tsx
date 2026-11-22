import ToolPanel from './ToolPanel.tsx'
import type { WorkspaceInfo } from '../types.ts'

export default function AppHeader({
    status,
    busy,
    workspace,
    workspaceLoading,
    onOpenWorkspace,
    onReset,
}: {
    status: string
    busy: boolean
    workspace: WorkspaceInfo | null
    workspaceLoading: boolean
    onOpenWorkspace: () => void
    onReset: () => void
}) {
    const locked = busy || workspaceLoading

    return (
        <header className="app-header">
            <h1>迷你 Agent 控制台</h1>
            <span className={`status ${busy ? 'busy' : status === '已中断' ? 'warn' : ''}`}>
                {status}
            </span>
            <span className="spacer" />

            <div className="workspace-widget">
                {workspace && (
                    <button
                        type="button"
                        className="workspace-chip"
                        onClick={onOpenWorkspace}
                        disabled={locked}
                        title={`${workspace.path}（点击切换）`}
                    >
                        <span aria-hidden="true">📁</span>
                        <span className="workspace-name">{workspace.name}</span>
                    </button>
                )}
                <button
                    type="button"
                    className={`workspace-add ${workspace ? 'compact' : ''}`}
                    onClick={onOpenWorkspace}
                    disabled={locked}
                    title="选择要处理的仓库目录"
                    aria-label="选择仓库目录"
                >
                    <span aria-hidden="true">＋</span>
                    {!workspace && (
                        <span>{workspaceLoading ? '读取中…' : '选择仓库'}</span>
                    )}
                </button>
            </div>

            <ToolPanel busy={busy} />
            <button type="button" onClick={onReset} disabled={busy}>
                清空上下文
            </button>
        </header>
    )
}
