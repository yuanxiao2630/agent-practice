import { useState } from 'react'
import Markdown from './Markdown.tsx'

const COLLAPSE_AT = 420

/** 回答太长时先折起来，点「展开全文」再看完整内容 */
export default function AssistantBubble({ text }: { text: string }) {
    const [expanded, setExpanded] = useState(false)
    const long = text.length > COLLAPSE_AT

    return (
        <div className="msg assistant">
            <div className="label">Agent</div>
            <div className={`bubble assistant ${long && !expanded ? 'clamped' : ''}`}>
                <div className="bubble-text markdown">
                    <Markdown text={text} />
                </div>
                {long && !expanded && <div className="fade" />}
            </div>
            {long && (
                <button type="button" className="link-btn" onClick={() => setExpanded((v) => !v)}>
                    {expanded ? '收起' : '展开全文'}
                </button>
            )}
        </div>
    )
}
