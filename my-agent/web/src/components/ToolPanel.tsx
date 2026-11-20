import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchTools, toggleTools } from '../api/tools.ts'
import type { ToolToggleTarget } from '../api/tools.ts'
import type { ToolInfo, ToolSource } from '../types.ts'

const SOURCE_LABEL: Record<ToolInfo['source'], string> = {
    builtin: '内置',
    mcp: 'MCP',
}

type ToggleHandler = (target: ToolToggleTarget, enabled: boolean) => void
type GroupToggleHandler = (source: ToolSource, enabled: boolean) => void

function targetKey(target: ToolToggleTarget): string {
    return 'name' in target ? `name:${target.name}` : `source:${target.source}`
}

function ToolRow({
    tool,
    disabled,
    onToggle,
}: {
    tool: ToolInfo
    disabled: boolean
    onToggle: ToggleHandler
}) {
    return (
        <div className={`tool-item ${tool.enabled ? '' : 'off'}`}>
            <div className="tool-info">
                <div className="tool-name-row">
                    <span className="tool-name">{tool.name}</span>
                    <span className={`tool-source ${tool.source}`}>{SOURCE_LABEL[tool.source]}</span>
                </div>
                <p className="tool-desc">{tool.description || '（暂无描述）'}</p>
            </div>

            <button
                type="button"
                role="switch"
                aria-checked={tool.enabled}
                aria-label={`${tool.enabled ? '停用' : '启用'} ${tool.name}`}
                className={`switch ${tool.enabled ? 'on' : ''}`}
                disabled={disabled}
                onClick={() => onToggle({ name: tool.name }, !tool.enabled)}
            >
                <span className="knob" aria-hidden="true" />
            </button>
        </div>
    )
}

function ToolGroup({
    title,
    source,
    tools,
    disabled,
    onToggle,
    onToggleGroup,
}: {
    title: string
    source: ToolSource
    tools: ToolInfo[]
    disabled: boolean
    onToggle: ToggleHandler
    onToggleGroup: GroupToggleHandler
}) {
    if (tools.length === 0) return null

    const enabledCount = tools.filter((tool) => tool.enabled).length
    const allOn = enabledCount === tools.length
    const allOff = enabledCount === 0
    const mixed = !allOn && !allOff

    return (
        <div className="tool-group">
            <div className="tool-group-head">
                <span className="tool-group-title">{title}</span>
                <span className="tool-group-count">
                    {enabledCount}/{tools.length}
                </span>
                <span className="tool-group-master">
                    <span className="tool-group-master-label">总开关</span>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={allOn ? 'true' : mixed ? 'mixed' : 'false'}
                        aria-label={`${allOn ? '全部停用' : '全部启用'}${title}`}
                        title={`${title}总开关：当前启用 ${enabledCount}/${tools.length}`}
                        className={`switch small ${allOn ? 'on' : ''} ${mixed ? 'mixed' : ''}`}
                        disabled={disabled}
                        onClick={() => onToggleGroup(source, !allOn)}
                    >
                        <span className="knob" aria-hidden="true" />
                    </button>
                </span>
            </div>
            {tools.map((tool) => (
                <ToolRow key={tool.name} tool={tool} disabled={disabled} onToggle={onToggle} />
            ))}
        </div>
    )
}

/** 顶部「工具」按钮 + 浮层：展示全部可用工具，并用开关控制是否发给模型 */
export default function ToolPanel({ busy }: { busy: boolean }) {
    const [open, setOpen] = useState(false)
    const [tools, setTools] = useState<ToolInfo[]>([])
    const [loading, setLoading] = useState(true)
    const [pending, setPending] = useState<string | null>(null)
    const [error, setError] = useState('')
    const boxRef = useRef<HTMLDivElement>(null)

    const load = useCallback(async () => {
        setLoading(true)
        setError('')
        try {
            setTools(await fetchTools())
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void load()
    }, [load])

    // 面板打开时：点外部 / 按 Esc 关闭
    useEffect(() => {
        if (!open) return

        const onPointerDown = (event: MouseEvent) => {
            if (!boxRef.current?.contains(event.target as Node)) setOpen(false)
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false)
        }

        document.addEventListener('mousedown', onPointerDown)
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('mousedown', onPointerDown)
            document.removeEventListener('keydown', onKeyDown)
        }
    }, [open])

    const update = async (target: ToolToggleTarget, enabled: boolean) => {
        if (busy || pending) return
        setPending(targetKey(target))
        setError('')
        try {
            setTools(await toggleTools(target, enabled))
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setPending(null)
        }
    }

    const toggleGroup = (source: ToolSource, enabled: boolean) => {
        void update({ source }, enabled)
    }

    const enabledCount = tools.filter((tool) => tool.enabled).length
    const builtin = tools.filter((tool) => tool.source === 'builtin')
    const mcp = tools.filter((tool) => tool.source === 'mcp')
    const allEnabled = tools.length > 0 && enabledCount === tools.length
    const allDisabled = tools.length > 0 && enabledCount === 0
    const locked = busy || pending !== null || loading
    const countLabel = loading ? '…' : tools.length === 0 ? '–' : `${enabledCount}/${tools.length}`

    return (
        <div className="tool-panel" ref={boxRef}>
            <button
                type="button"
                className={`tool-trigger ${open ? 'active' : ''}`}
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
            >
                <span className="tool-trigger-icon" aria-hidden="true">
                    ⚙
                </span>
                <span>工具</span>
                <span className="tool-count">{countLabel}</span>
                <span className={`chevron ${open ? 'down' : 'right'}`} aria-hidden="true" />
            </button>

            {open && (
                <div className="tool-popover" role="dialog" aria-label="可用工具">
                    <div className="tool-popover-head">
                        <div>
                            <div className="tool-popover-title">可用工具</div>
                            <div className="tool-popover-sub">
                                已启用 {enabledCount} / {tools.length}
                            </div>
                        </div>
                        <div className="tool-bulk">
                            <button
                                type="button"
                                className="link-btn"
                                disabled={locked || allEnabled}
                                onClick={() => void update({ name: '*' }, true)}
                            >
                                全部开启
                            </button>
                            <button
                                type="button"
                                className="link-btn"
                                disabled={locked || allDisabled}
                                onClick={() => void update({ name: '*' }, false)}
                            >
                                全部关闭
                            </button>
                        </div>
                    </div>

                    {error && (
                        <div className="tool-error" role="alert">
                            <span>{error}</span>
                            <button type="button" className="link-btn" onClick={() => void load()}>
                                重试
                            </button>
                        </div>
                    )}

                    {loading ? (
                        <div className="tool-empty">加载中…</div>
                    ) : tools.length === 0 ? (
                        !error && <div className="tool-empty">暂无可用工具</div>
                    ) : (
                        <div className="tool-list">
                            <ToolGroup
                                title="内置工具"
                                source="builtin"
                                tools={builtin}
                                disabled={locked}
                                onToggle={update}
                                onToggleGroup={toggleGroup}
                            />
                            <ToolGroup
                                title="MCP 工具"
                                source="mcp"
                                tools={mcp}
                                disabled={locked}
                                onToggle={update}
                                onToggleGroup={toggleGroup}
                            />
                        </div>
                    )}

                    <div className="tool-note">
                        {busy
                            ? 'Agent 正在运行，结束后可调整工具'
                            : '关闭的工具不会发给模型，也不会被执行'}
                    </div>
                </div>
            )}
        </div>
    )
}
