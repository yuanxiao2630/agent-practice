import { useCallback, useEffect, useState } from 'react'
import {
    clearWorkspace as clearWorkspaceRequest,
    fetchWorkspace,
    selectWorkspace,
} from '../api/workspace.ts'
import type { SelectWorkspaceResult, WorkspaceInfo } from '../types.ts'

/**
 * 当前会话的仓库目录。
 * 服务端内存态：刷新页面还在，重启服务就回到「未选择」。
 */
export function useWorkspace() {
    const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    useEffect(() => {
        let alive = true

        fetchWorkspace()
            .then((value) => {
                if (!alive) return
                setWorkspace(value)
                setError('')
            })
            .catch((err) => {
                if (!alive) return
                setError(err instanceof Error ? err.message : String(err))
            })
            .finally(() => {
                if (alive) setLoading(false)
            })

        return () => {
            alive = false
        }
    }, [])

    const choose = useCallback(async (path: string): Promise<SelectWorkspaceResult> => {
        const result = await selectWorkspace(path)
        setWorkspace(result.workspace)
        setError('')
        return result
    }, [])

    const clear = useCallback(async (): Promise<void> => {
        await clearWorkspaceRequest()
        setWorkspace(null)
        setError('')
    }, [])

    return { workspace, loading, error, choose, clear }
}
