export async function searchWeb(query: string, count = 5) {
  const res = await fetch('https://api.deepseek.com/v1/tools/search', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, count }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`search failed: HTTP ${res.status}`)
  const data = await res.json()
  console.log('\n\n网页搜索结果', JSON.stringify(data))
  console.log('网页搜索结果============end\n\n')
  return data.results
    .filter((r: any) => r.rerank_score >= 1.5)   // 过滤低质结果
    .map((r: any) => ({ title: r.title, url: r.url, summary: r.summary.slice(0, 800) }))
}