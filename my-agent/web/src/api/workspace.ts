import type {
    BrowseResult,
    SelectWorkspaceResult,
    WorkspaceInfo,
} from '../types.ts'

async function errorMessage(res: Response): Promise<string> {
    const data = await res.json().catch(() => ({}))
    return typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`
}

export async function fetchWorkspace(): Promise<WorkspaceInfo | null> {
    const res = await fetch('/api/workspace')
    if (!res.ok) throw new Error(await errorMessage(res))
    const data = await res.json()
    return (data.workspace ?? null) as WorkspaceInfo | null
}

/** 打开选择器：不传 path 时由服务端决定起点（当前仓库 / 桌面 / 主目录） */
export async function browseWorkspace(path?: string): Promise<BrowseResult> {
    const query = path ? `?path=${encodeURIComponent(path)}` : ''
    const res = await fetch(`/api/workspace/browse${query}`)
    if (!res.ok) throw new Error(await errorMessage(res))
    return (await res.json()) as BrowseResult
}

export async function selectWorkspace(path: string): Promise<SelectWorkspaceResult> {
    const res = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path }),
    })
    if (!res.ok) throw new Error(await errorMessage(res))
    const data = await res.json()
    return {
        workspace: data.workspace as WorkspaceInfo,
        reset: Boolean(data.reset),
    }
}

export async function clearWorkspace(): Promise<void> {
    const res = await fetch('/api/workspace', { method: 'DELETE' })
    if (!res.ok) throw new Error(await errorMessage(res))
}
