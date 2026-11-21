import type { SearchBackend, SearchBackendInfo } from '../types.ts'

const BACKEND_LABEL: Record<SearchBackend, string> = {
    parallel: 'Parallel',
    deepseek: 'DeepSeek',
}

/** 工具浮层顶部的搜索后端选择器：Parallel / DeepSeek 两段按钮 */
export default function SearchBackendBar({
    info,
    disabled,
    pending,
    onSelect,
}: {
    info: SearchBackendInfo
    /** 面板整体锁定（busy / 其他请求 pending / loading） */
    disabled: boolean
    /** 本组件自己的 POST 进行中 */
    pending: boolean
    onSelect: (backend: SearchBackend) => void
}) {
    const options: { value: SearchBackend; unavailable: boolean }[] = [
        { value: 'parallel', unavailable: !info.parallelAvailable },
        { value: 'deepseek', unavailable: !info.deepseekAvailable },
    ]
    const locked = disabled || pending || info.locked

    return (
        <div className="search-backend">
            <span className="search-backend-label">联网搜索后端</span>
            <div
                className="search-backend-seg"
                role="radiogroup"
                aria-label="联网搜索后端"
            >
                {options.map(({ value, unavailable }) => {
                    const active = info.backend === value
                    const title = unavailable
                        ? `${BACKEND_LABEL[value]} 未配置`
                        : undefined
                    return (
                        <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            className={`search-backend-opt ${active ? 'active' : ''} ${unavailable ? 'unavailable' : ''}`}
                            disabled={locked || unavailable || active}
                            title={title}
                            onClick={() => onSelect(value)}
                        >
                            {BACKEND_LABEL[value]}
                            {unavailable && '（未配置）'}
                        </button>
                    )
                })}
            </div>
            {info.locked && (
                <span className="search-backend-hint">
                    由环境变量 LLM_SEARCH_PROVIDER 锁定
                </span>
            )}
        </div>
    )
}
