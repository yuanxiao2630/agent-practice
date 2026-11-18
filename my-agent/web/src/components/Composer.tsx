import { useLayoutEffect, useRef, useState } from 'react'

export default function Composer({
    disabled,
    onSend,
}: {
    disabled: boolean
    onSend: (text: string) => void
}) {
    const [value, setValue] = useState('')
    const ref = useRef<HTMLTextAreaElement>(null)

    useLayoutEffect(() => {
        const el = ref.current
        if (!el) return
        el.style.height = 'auto'
        el.style.height = Math.min(el.scrollHeight, 160) + 'px'
    }, [value])

    const submit = () => {
        const text = value.trim()
        if (!text || disabled) return
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
            <div className="inner">
                <textarea
                    ref={ref}
                    rows={1}
                    value={value}
                    disabled={disabled}
                    placeholder="输入问题，Enter 发送，Shift + Enter 换行"
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                            e.preventDefault()
                            submit()
                        }
                    }}
                />
                <button type="submit" className="primary" disabled={disabled || !value.trim()}>
                    发送
                </button>
            </div>
        </form>
    )
}
