import {
    browseDirectory,
    clearWorkspace,
    getWorkspace,
    setWorkspace,
} from '../../util/workspace.ts'
import { isRunning, resetMessages } from '../../session.ts'
import { readJsonObject } from '../body.ts'
import { HttpError, sendJson } from '../respond.ts'
import type { Ctx } from './types.ts'

/** 切仓库会换掉整个上下文，所以运行中一律拒绝，避免工具串到新目录 */
function assertIdle(action: string): void {
    if (isRunning()) throw new HttpError(409, `Agent 正在运行，先中断再${action}`)
}

/** 本次会话选中的仓库；未选择时 workspace 为 null */
export function getWorkspaceRoute({ res }: Ctx): void {
    sendJson(res, 200, { workspace: getWorkspace() })
}

/** 「＋ 选择仓库」弹窗用的一级目录浏览 */
export async function browseWorkspaceRoute({ res, url }: Ctx): Promise<void> {
    const data = await browseDirectory(url.searchParams.get('path') ?? undefined)
    sendJson(res, 200, data)
}

/** 选择仓库：换了不同目录才清空对话，选同一个不算切换 */
export async function selectWorkspaceRoute({ req, res }: Ctx): Promise<void> {
    assertIdle('切换仓库')

    const body = await readJsonObject(req)
    const target = body['path']
    if (typeof target !== 'string' || !target.trim()) throw new HttpError(400, 'path 必填')

    const previous = getWorkspace()
    const workspace = await setWorkspace(target)
    const reset = previous?.path !== workspace.path
    if (reset) await resetMessages()

    sendJson(res, 200, { workspace, reset })
}

/** 取消选择：回到「不允许读取任何本地文件」的状态 */
export async function clearWorkspaceRoute({ res }: Ctx): Promise<void> {
    assertIdle('取消仓库')

    clearWorkspace()
    await resetMessages()

    sendJson(res, 200, { workspace: null, reset: true })
}
