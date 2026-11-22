import type { ToolInfo, ToolSource } from '../types.ts'

type ToolPayload = {
    tools?: ToolInfo[]
}

/** 单个工具，或按来源整组（如 MCP 总开关） */
export type ToolToggleTarget = { name: string } | { source: ToolSource }

async function readPayload(res: Response): Promise<ToolPayload> {
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`)
    }
    return data as ToolPayload
}

export async function fetchTools(): Promise<ToolInfo[]> {
    const res = await fetch('/api/tools')
    const data = await readPayload(res)
    return data.tools ?? []
}

/** target 传 { name: '*' } 表示全部开启 / 全部关闭 */
export async function toggleTools(
    target: ToolToggleTarget,
    enabled: boolean,
): Promise<ToolInfo[]> {
    const res = await fetch('/api/tools/toggle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...target, enabled }),
    })
    const data = await readPayload(res)
    return data.tools ?? []
}
