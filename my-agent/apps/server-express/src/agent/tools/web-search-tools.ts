import { DEEPSEEK_API_KEY } from '../../config/index.ts'

type SearchResult = {
    title: string
    url: string
    summary: string
    rerank_score?: number
}

type SearchResponse = {
    results?: SearchResult[]
}

/**
 * 联网搜索。默认只保留 rerank_score >= 1.5 的结果，摘要截到 800 字符，
 * 避免把整页正文塞进上下文。
 */
export async function searchWeb(query: string, count = 5, signal?: AbortSignal) {
    if (!DEEPSEEK_API_KEY) throw new Error('缺少 DEEPSEEK_API_KEY，无法调用搜索接口')

    const res = await fetch('https://api.deepseek.com/v1/tools/search', {
        method: 'POST',
        headers: {
            authorization: `Bearer ${DEEPSEEK_API_KEY}`,
            'content-type': 'application/json',
        },
        body: JSON.stringify({ query, count }),
        // 用户中断时要能立刻停下；15 秒兜底避免请求永远挂着
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    })

    if (!res.ok) throw new Error(`search failed: HTTP ${res.status}`)

    const data = (await res.json()) as SearchResponse

    return (data.results ?? [])
        .filter((r) => (r.rerank_score ?? 0) >= 1.5)
        .map((r) => ({ title: r.title, url: r.url, summary: r.summary.slice(0, 800) }))
}
