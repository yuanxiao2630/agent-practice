import type { Request, Response } from 'express'
import {
    browseDirectory,
    clearWorkspace,
    getWorkspace,
    setWorkspace,
} from '../../util/workspace.ts'
import { isRunning, resetMessages } from '../../session.ts'
import { bodyOf } from '../body.ts'
import { HttpError, sendJson } from '../errors.ts'
import type { RouteHandler } from './types.ts'

/** 切仓库会换掉整个上下文，所以运行中一律拒绝，避免工具串到新目录 */
function assertIdle(action: string): void {
    if (isRunning()) throw new HttpError(409, `Agent 正在运行，先中断再${action}`)
}

/** 本次会话选中的仓库；未选择时 workspace 为 null */
export function getWorkspaceRoute(_req: Request, res: Response): void {
    sendJson(res, 200, { workspace: getWorkspace() })
}

/** 「＋ 选择仓库」弹窗用的一级目录浏览 */
export const browseWorkspaceRoute: RouteHandler = async (req: Request, res: Response) => {
    // Express 的 query 可能是 string | string[]；原版 URLSearchParams.get 只取第一个
    const raw = req.query['path']
    const input = Array.isArray(raw) ? raw[0] : raw
    const data = await browseDirectory(typeof input === 'string' ? input : undefined)
    sendJson(res, 200, data)
}

/** 选择仓库：换了不同目录才清空对话，选同一个不算切换 */
export const selectWorkspaceRoute: RouteHandler = async (req, res) => {
    assertIdle('切换仓库')

    const body = bodyOf(req)
    const target = body['path']
    if (typeof target !== 'string' || !target.trim()) throw new HttpError(400, 'path 必填')

    const previous = getWorkspace()
    const workspace = await setWorkspace(target)
    const reset = previous?.path !== workspace.path
    if (reset) resetMessages()

    sendJson(res, 200, { workspace, reset })
}

/** 取消选择：回到「不允许读取任何本地文件」的状态 */
export function clearWorkspaceRoute(_req: Request, res: Response): void {
    assertIdle('取消仓库')

    clearWorkspace()
    resetMessages()

    sendJson(res, 200, { workspace: null, reset: true })
}
