import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export default function Composer({
    busy,
    cancelling,
    hasWorkspace,
    onPickWorkspace,
    onSend,
    onCancel,
}: {
    busy: boolean
    cancelling: boolean
    hasWorkspace: boolean
    onPickWorkspace: () => void
    onSend: (text: string) => void
    onCancel: () => void
}) {
    const [value, setValue] = useState('')
    const ref = useRef<HTMLTextAreaElement>(null)
    const wasBusy = useRef(false)

    useLayoutEffect(() => {
        const el = ref.current
        if (!el) return
        el.style.height = 'auto'
        el.style.height = Math.min(el.scrollHeight, 160) + 'px'
    }, [value])

    // 生成/中断结束后把焦点还给输入框，方便立刻改问法
    useEffect(() => {
        if (wasBusy.current && !busy) ref.current?.focus()
        wasBusy.current = busy
    }, [busy])

    const submit = () => {
        const text = value.trim()
        if (!text || busy) return
        setValue('')
        onSend(text)
        ref.current?.focus()
    }

    return (
        <form
            className="composer"
            onSubmit={(e) => {
                e.preventDefault()
                submit()
            }}
        >
            {!hasWorkspace && (
                <div className="composer-note">
                    <span>未选择工作区：仅支持普通对话，Agent 不会读取本地文件。</span>
                    <button type="button" className="link-btn" onClick={onPickWorkspace}>
                        ＋ 选择工作区
                    </button>
                </div>
            )}

            <div className="inner">
                <textarea
                    ref={ref}
                    rows={1}
                    value={value}
                    // 运行中也允许继续打字，只是发不出去；禁用输入框会让人以为页面卡死
                    placeholder={
                        busy
                            ? '正在生成…'
                            : !hasWorkspace
                                ? '输入问题（未选择工作区，不会读取本地文件）'
                                : '输入问题，Enter 发送，Shift + Enter 换行'
                    }
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                            e.preventDefault()
                            submit()
                        }
                    }}
                />
                {busy ? (
                    <button
                        type="button"
                        className="danger"
                        onClick={onCancel}
                        disabled={cancelling}
                        title="中断本轮（Esc）"
                    >
                        {cancelling ? '停止中…' : '停止'}
                    </button>
                ) : (
                    <button type="submit" className="primary" disabled={!value.trim()}>
                        发送
                    </button>
                )}
            </div>
        </form>
    )
}
