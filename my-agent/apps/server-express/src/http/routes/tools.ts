import type { Request, Response } from 'express'
import {
    setToolEnabled,
    setToolsEnabledBySource,
    toolSnapshot,
    type ToolSource,
} from '../../agent/tools/index.ts'
import { isRunning } from '../../session.ts'
import { bodyOf } from '../body.ts'
import { HttpError, sendJson } from '../errors.ts'
import type { RouteHandler } from './types.ts'

/** 工具面板：当前所有工具 + 开关状态 */
export function getToolsRoute(_req: Request, res: Response): void {
    sendJson(res, 200, toolSnapshot())
}

/**
 * 开关工具：name 传 '*' 表示全部；source 表示整个分组（如 MCP 总开关）。
 * name 和 source 二选一，避免「看起来两个都传了但只生效一个」的歧义。
 */
export const toggleToolRoute: RouteHandler = (req, res) => {
    const body = bodyOf(req)

    const name = typeof body['name'] === 'string' ? body['name'].trim() : ''
    const source = body['source']
    const enabled = body['enabled']

    if (typeof enabled !== 'boolean') throw new HttpError(400, 'enabled 必填')
    if (source !== undefined && source !== 'builtin' && source !== 'mcp') {
        throw new HttpError(400, 'source 只能是 builtin 或 mcp')
    }
    if (Boolean(name) === Boolean(source)) {
        throw new HttpError(400, 'name 和 source 需要且只能传一个')
    }

    // 工具列表在每轮请求开始时确定，运行中切换会让同一轮前后不一致
    if (isRunning()) throw new HttpError(409, 'Agent 正在运行，等这一轮结束再调整工具')

    if (source) {
        if (!setToolsEnabledBySource(source as ToolSource, enabled)) {
            throw new HttpError(404, '该分组暂无工具')
        }
    } else if (!setToolEnabled(name, enabled)) {
        throw new HttpError(404, `未知工具: ${name}`)
    }

    sendJson(res, 200, toolSnapshot())
}
