import type { SearchBackend, ToolSource, ToolsResponse } from '../types.ts'

/** 单个工具，或按来源整组（如 MCP 总开关） */
export type ToolToggleTarget = { name: string } | { source: ToolSource }

async function readPayload(res: Response): Promise<ToolsResponse> {
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`)
    }
    return data as ToolsResponse
}

/** GET /api/tools 与 POST /api/search-backend、POST /api/tools/toggle 返回同一结构 */
export async function fetchTools(): Promise<ToolsResponse> {
    const res = await fetch('/api/tools')
    return readPayload(res)
}

/** target 传 { name: '*' } 表示全部开启 / 全部关闭 */
export async function toggleTools(
    target: ToolToggleTarget,
    enabled: boolean,
): Promise<ToolsResponse> {
    const res = await fetch('/api/tools/toggle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...target, enabled }),
    })
    return readPayload(res)
}

/** 切换联网搜索后端（Parallel / DeepSeek）；409 时服务端返回 { error } */
export async function setSearchBackend(
    backend: SearchBackend,
): Promise<ToolsResponse> {
    const res = await fetch('/api/search-backend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ backend }),
    })
    return readPayload(res)
}
