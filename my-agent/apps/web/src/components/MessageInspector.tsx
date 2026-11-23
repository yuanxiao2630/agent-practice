import { useMemo, useRef, useState } from 'react'
import type { ChatMessage, RoundSnapshot } from '../types.ts'

type Props = {
    snapshots: RoundSnapshot[]
    /** final 事件带回来的完整上下文 */
    finalMessages?: ChatMessage[]
}

const ROLE_LABEL: Record<ChatMessage['role'], string> = {
    system: 'system',
    user: 'user',
    assistant: 'assistant',
    tool: 'tool',
}

/** 把一条消息摊平成可读文本：正文 + tool_calls */
function messageText(m: ChatMessage): string {
    const parts: string[] = []
    if (m.content) parts.push(m.content)
    if (m.role === 'assistant') {
        for (const tc of m.tool_calls ?? []) {
            const name = tc.function?.name ?? tc.type
            const args = tc.function?.arguments ?? ''
            parts.push(`→ ${name}(${args})`)
        }
    }
    return parts.join('\n\n')
}

function MessageCard({ message, index }: { message: ChatMessage; index: number }) {
    const [expanded, setExpanded] = useState(false)
    const text = messageText(message)
    const long = text.length > 400 || text.split('\n').length > 6

    return (
        <article className={`msg-card role-${message.role}`}>
            <header className="msg-card-head">
                <span className="idx">#{index + 1}</span>
                <span className="role-badge">{ROLE_LABEL[message.role]}</span>
                {message.role === 'assistant' &&
                    message.tool_calls?.map((tc) => (
                        <span key={tc.id} className="tag tool-tag">
                            {tc.function?.name ?? tc.type}
                        </span>
                    ))}
                {message.role === 'tool' && message.tool_call_id && (
                    <span className="tag id-tag" title={message.tool_call_id}>
                        {message.tool_call_id.slice(0, 8)}
                    </span>
                )}
                <span className="spacer" />
                <span className="len">{text.length} 字符</span>
            </header>

            <div className={`msg-card-body ${long && !expanded ? 'clamped' : ''}`}>
                <pre>{text || '（空）'}</pre>
                {long && !expanded && <div className="fade" />}
            </div>

            {long && (
                <button type="button" className="link-btn" onClick={() => setExpanded((v) => !v)}>
                    {expanded ? '收起' : '展开'}
                </button>
            )}
        </article>
    )
}

export default function MessageInspector({ snapshots, finalMessages }: Props) {
    const [open, setOpen] = useState(false)
    const [active, setActive] = useState('final')
    const boxRef = useRef<HTMLElement>(null)

    const tabs = useMemo(() => {
        const list = snapshots.map((s) => ({
            key: String(s.round),
            label: `第 ${s.round} 轮`,
            messages: s.messages,
        }))
        if (finalMessages) list.push({ key: 'final', label: '最终', messages: finalMessages })
        return list
    }, [snapshots, finalMessages])

    if (tabs.length === 0) return null

    const current = tabs.find((t) => t.key === active) ?? tabs[tabs.length - 1]!
    const total = current.messages.length

    // 面板展开后内容会变高。如果顶部已经被顶出可视区，就把面板顶对齐到滚动容器顶部
    const toggle = () => {
        const next = !open
        setOpen(next)
        if (!next) return
        requestAnimationFrame(() => {
            const el = boxRef.current
            const main = el?.closest('main')
            if (!el || !main) return
            const offset = el.getBoundingClientRect().top - main.getBoundingClientRect().top
            if (offset < 8) {
                main.scrollTo({ top: main.scrollTop + offset - 12, behavior: 'smooth' })
            }
        })
    }

    return (
        <section ref={boxRef} className={`inspector ${open ? 'open' : ''}`}>
            <button
                type="button"
                className="inspector-toggle"
                onClick={toggle}
                aria-expanded={open}
            >
                <span className={`chevron ${open ? 'down' : 'right'}`} aria-hidden="true" />
                <span>查看上下文</span>
                <span className="meta">
                    {total} 条消息 · {current.label}
                </span>
            </button>

            {open && (
                <div className="inspector-body">
                    <div className="tabs" role="tablist">
                        {tabs.map((t) => (
                            <button
                                key={t.key}
                                type="button"
                                role="tab"
                                aria-selected={t.key === current.key}
                                className={`tab ${t.key === current.key ? 'active' : ''}`}
                                onClick={() => setActive(t.key)}
                            >
                                {t.label}
                                <span className="count">{t.messages.length}</span>
                            </button>
                        ))}
                    </div>

                    <div className="msg-list">
                        {current.messages.map((m, i) => (
                            <MessageCard key={i} message={m} index={i} />
                        ))}
                    </div>
                </div>
            )}
        </section>
    )
}
