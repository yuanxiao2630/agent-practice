import { z } from 'zod'
import { LLM_API_KEY } from '../provider.ts'
import { ParallelMcpClient } from '../mcp/parallel-mcp.ts'
import { getSearchBackend } from './search-backend.ts'

/**
 * searchWeb 的后端选择：
 *   parallel —— Parallel 托管 MCP（默认，免 key，fast 模式有速率限制）；
 *   deepseek —— DeepSeek 的 /v1/tools/search（需要 DEEPSEEK/LLM key）。
 *   后端在调用时读取（search-backend.ts），可由 /api/search-backend 运行时切换；
 *   Parallel 挂掉时自动回退 DeepSeek（仅当 key 存在）。
 */
const parallelClient = new ParallelMcpClient()
let parallelReady: Promise<void> | undefined

function ensureParallel(): Promise<void> {
  parallelReady ??= parallelClient.connect().catch((e) => {
    parallelReady = undefined // 下次调用重试
    throw e
  })
  return parallelReady
}

type ParallelResultItem = {
  url?: string
  title?: string
  publish_date?: string
  excerpts?: string[]
}

function isParallelResultItem(value: unknown): value is ParallelResultItem {
  return !!value && typeof value === 'object'
}

async function parallelSearch(query: string): Promise<unknown> {
  await ensureParallel()
  const result = await parallelClient.callTool('web_search', {
    // web_search 必填 objective + search_queries；把用户的一句话同时当目标和关键词查询
    objective: query,
    search_queries: [query],
  })
  const text = ParallelMcpClient.extractContent(result)
  const extracted = extractResults(text)

  // Parallel 返回 {results:[{url,title,publish_date,excerpts}]}，
  // 摊平成模型熟悉的 {title,url,summary} 结构；excerpts 数组拼成 summary
  if (!Array.isArray(extracted)) return extracted
  return extracted.filter(isParallelResultItem).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    publish_date: r.publish_date,
    summary: (r.excerpts ?? []).join('\n').slice(0, 800),
  }))
}

/** MCP 返回的 text 块通常是 JSON 字符串；解析失败就当摘要原文返回 */
function extractResults(text: string): unknown {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return [{ title: 'search result', url: '', summary: text.slice(0, 2000) }]
  }

  if (!parsed || typeof parsed !== 'object') return parsed
  const results = 'results' in parsed ? parsed.results : parsed
  return Array.isArray(results) ? results : parsed
}

// DeepSeek /v1/tools/search 的返回结构：results[] 带 rerank_score，
// 过滤掉低质结果后只保留 title/url/summary 三个字段给模型
const DeepSeekSearchResponse = z.object({
  results: z.array(z.object({
    title: z.string(),
    url: z.string(),
    summary: z.string(),
    rerank_score: z.number(),
  }).loose()),
}).loose()

/**
 * 原版 DeepSeek 搜索：直连 https://api.deepseek.com/v1/tools/search。
 * key 用 LLM_API_KEY（provider.ts 里它已回退到 DEEPSEEK_API_KEY）。
 * 与 Parallel 互为独立后端，deepseek 模式下失败不会回退 parallel。
 */
async function deepseekSearch(query: string, count = 5) {
  if (!LLM_API_KEY) throw new Error('deepseek 搜索需要 LLM_API_KEY 或 DEEPSEEK_API_KEY')

  const res = await fetch('https://api.deepseek.com/v1/tools/search', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${LLM_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, count }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`search failed: HTTP ${res.status}`)

  const parsed = DeepSeekSearchResponse.safeParse(await res.json())
  // 原实现会对缺失字段直接抛 TypeError；这里给出更明确的错误，语义一致
  if (!parsed.success) throw new Error('DeepSeek 搜索返回结构异常')

  console.log('\n\n网页搜索结果', JSON.stringify(parsed.data))
  console.log('网页搜索结果============end\n\n')
  return parsed.data.results
    .filter((r) => r.rerank_score >= 1.5)   // 过滤低质结果
    .map((r) => ({ title: r.title, url: r.url, summary: r.summary.slice(0, 800) }))
}

export async function searchWeb(query: string): Promise<unknown> {
  // 调用时读取后端，运行时切换立即生效；deepseek 模式是纯直连，不做 parallel 尝试
  if (getSearchBackend() === 'deepseek') return deepseekSearch(query)

  try {
    return await parallelSearch(query)
  } catch (e) {
    // Parallel 不可用时回退 DeepSeek（需要 key）；都没有才抛错
    if (LLM_API_KEY) {
      console.warn('[searchWeb] Parallel 失败，回退 DeepSeek：', e instanceof Error ? e.message : e)
      return deepseekSearch(query)
    }
    throw e
  }
}
