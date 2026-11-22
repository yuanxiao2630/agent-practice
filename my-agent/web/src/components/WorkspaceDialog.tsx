import { useCallback, useEffect, useRef, useState } from 'react'
import { browseWorkspace } from '../api/workspace.ts'
import type { BrowseResult, WorkspaceInfo } from '../types.ts'

type Props = {
    open: boolean
    busy: boolean
    current: WorkspaceInfo | null
    hasConversation: boolean
    onClose: () => void
    onChoose: (path: string) => Promise<void>
    onClear: () => Promise<void>
}

function errorText(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
}

/** 把绝对路径拆成面包屑；同时兼容 macOS/Linux 的 / 和 Windows 的盘符 */
function pathCrumbs(full: string): { label: string; path: string }[] {
    const win = /^([A-Za-z]:)[\\/](.*)$/.exec(full)
    if (win) {
        const root = `${win[1]}\\`
        const crumbs = [{ label: root, path: root }]
        let acc = root
        for (const part of win[2].split(/[\\/]/).filter(Boolean)) {
            acc = acc.endsWith('\\') ? acc + part : acc + '\\' + part
            crumbs.push({ label: part, path: acc })
        }
        return crumbs
    }

    if (!full.startsWith('/')) return [{ label: full, path: full }]

    const crumbs = [{ label: '/', path: '/' }]
    let acc = ''
    for (const part of full.split('/').filter(Boolean)) {
        acc += '/' + part
        crumbs.push({ label: part, path: acc })
    }
    return crumbs
}

export default function WorkspaceDialog({
    open,
    busy,
    current,
    hasConversation,
    onClose,
    onChoose,
    onClear,
}: Props) {
    const [data, setData] = useState<BrowseResult | null>(null)
    const [pathInput, setPathInput] = useState('')
    const [loading, setLoading] = useState(false)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState('')
    const [showHidden, setShowHidden] = useState(false)

    const requestId = useRef(0)
    const dialogRef = useRef<HTMLDivElement>(null)

    const load = useCallback(async (target?: string) => {
        const id = ++requestId.current
        setLoading(true)
        setError('')

        try {
            const result = await browseWorkspace(target)
            if (id !== requestId.current) return
            setData(result)
            setPathInput(result.path)
        } catch (err) {
            if (id !== requestId.current) return
            setError(errorText(err))
        } finally {
            if (id === requestId.current) setLoading(false)
        }
    }, [])

    // 每次打开都从当前仓库（或默认的桌面）重新开始
    useEffect(() => {
        if (!open) return
        setShowHidden(false)
        setError('')
        void load(current?.path)
    }, [open, current?.path, load])

    // Esc 关闭 + 锁住背景滚动 + 把焦点放到弹窗上
    useEffect(() => {
        if (!open) return

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !pending) {
                event.preventDefault()
                onClose()
            }
        }
        document.addEventListener('keydown', onKeyDown)

        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'

        const timer = window.setTimeout(() => dialogRef.current?.focus(), 0)

        return () => {
            document.removeEventListener('keydown', onKeyDown)
            document.body.style.overflow = previousOverflow
            window.clearTimeout(timer)
        }
    }, [open, pending, onClose])

    if (!open) return null

    const crumbs = data ? pathCrumbs(data.path) : []
    const visible = data?.entries.filter((entry) => showHidden || !entry.hidden) ?? []
    const parent = data?.parent ?? null
    const changed = Boolean(data && current?.path !== data.path)
    const note = error
        ? error
        : changed && hasConversation
            ? '切换仓库会清空当前对话'
            : 'Agent 只能读取所选目录内的文件'

    const choose = async () => {
        if (!data || pending || busy) return
        if (changed && hasConversation && !window.confirm('切换仓库会清空当前对话，继续？')) return

        setPending(true)
        setError('')
        try {
            await onChoose(data.path)
            onClose()
        } catch (err) {
            setError(errorText(err))
        } finally {
            setPending(false)
        }
    }

    const clearCurrent = async () => {
        if (!current || pending) return
        if (hasConversation && !window.confirm('取消选择会清空当前对话，之后 Agent 将不能读取任何本地文件。继续？')) {
            return
        }

        setPending(true)
        setError('')
        try {
            await onClear()
            onClose()
        } catch (err) {
            setError(errorText(err))
        } finally {
            setPending(false)
        }
    }

    return (
        <div
            className="modal-backdrop"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget && !pending) onClose()
            }}
        >
            <div
                className="workspace-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="选择要处理的仓库目录"
                tabIndex={-1}
                ref={dialogRef}
            >
                <div className="dialog-head">
                    <div>
                        <div className="dialog-title">选择要处理的仓库</div>
                        <div className="dialog-sub">只读取你选中的目录，不会扫描其它位置</div>
                    </div>
                    <button
                        type="button"
                        className="dialog-close"
                        onClick={onClose}
                        disabled={pending}
                        aria-label="关闭"
                    >
                        ×
                    </button>
                </div>

                {data && (
                    <div className="dialog-shortcuts">
                        {data.shortcuts.map((item) => (
                            <button
                                key={`${item.label}-${item.path}`}
                                type="button"
                                className="shortcut"
                                onClick={() => void load(item.path)}
                                disabled={loading}
                                title={item.path}
                            >
                                {item.label}
                            </button>
                        ))}
                        <label className="hidden-toggle">
                            <input
                                type="checkbox"
                                checked={showHidden}
                                onChange={(event) => setShowHidden(event.target.checked)}
                            />
                            显示隐藏目录
                        </label>
                    </div>
                )}

                <form
                    className="path-bar"
                    onSubmit={(event) => {
                        event.preventDefault()
                        void load(pathInput)
                    }}
                >
                    <input
                        value={pathInput}
                        onChange={(event) => setPathInput(event.target.value)}
                        spellCheck={false}
                        aria-label="目录路径"
                        placeholder="输入或粘贴目录的绝对路径"
                    />
                    <button type="submit" disabled={loading || !pathInput.trim()}>
                        前往
                    </button>
                </form>

                {data && (
                    <div className="breadcrumbs" aria-label="路径">
                        {crumbs.map((crumb, index) => (
                            <span className="crumb-item" key={`${crumb.path}-${index}`}>
                                {index > 1 && <span className="crumb-sep">/</span>}
                                <button
                                    type="button"
                                    className="crumb"
                                    onClick={() => void load(crumb.path)}
                                    disabled={loading}
                                    title={crumb.path}
                                >
                                    {crumb.label}
                                </button>
                            </span>
                        ))}
                    </div>
                )}

                <div className={`dir-list ${loading ? 'loading' : ''}`} aria-busy={loading}>
                    {parent && (
                        <button
                            type="button"
                            className="dir-row up"
                            onClick={() => void load(parent)}
                            disabled={loading}
                        >
                            <span className="dir-icon" aria-hidden="true">
                                ↰
                            </span>
                            <span className="dir-name">上一级</span>
                        </button>
                    )}

                    {!data && loading ? (
                        <div className="dir-empty">加载中…</div>
                    ) : !data ? (
                        <div className="dir-empty">
                            目录读取失败，可以关闭后重新打开，或直接粘贴路径再试。
                        </div>
                    ) : visible.length === 0 ? (
                        !loading && (
                            <div className="dir-empty">
                                这个目录下没有子文件夹，可以直接选它。
                            </div>
                        )
                    ) : (
                        visible.map((entry) => (
                            <button
                                key={entry.path}
                                type="button"
                                className="dir-row"
                                onClick={() => void load(entry.path)}
                                disabled={loading}
                                title={entry.path}
                            >
                                <span className="dir-icon" aria-hidden="true">
                                    {entry.isGitRepo ? '📦' : '📁'}
                                </span>
                                <span className="dir-name">{entry.name}</span>
                                {entry.isGitRepo && <span className="git-badge">git</span>}
                                {entry.hidden && <span className="hidden-badge">隐藏</span>}
                                <span className="dir-enter" aria-hidden="true">
                                    ›
                                </span>
                            </button>
                        ))
                    )}
                </div>

                <div className="dialog-foot">
                    <div className="dialog-note" role={error ? 'alert' : undefined}>
                        <span className={error ? 'err' : ''}>{note}</span>
                        {data?.isGitRepo && !error && <span className="git-badge">Git 仓库</span>}
                    </div>
                    {current && (
                        <button
                            type="button"
                            className="link-btn danger-text"
                            onClick={() => void clearCurrent()}
                            disabled={pending || loading}
                        >
                            取消选择
                        </button>
                    )}
                    <button type="button" onClick={onClose} disabled={pending}>
                        取消
                    </button>
                    <button
                        type="button"
                        className="primary"
                        onClick={() => void choose()}
                        disabled={!data || pending || loading || busy}
                    >
                        {pending ? '选择中…' : '选择此文件夹'}
                    </button>
                </div>
            </div>
        </div>
    )
}
