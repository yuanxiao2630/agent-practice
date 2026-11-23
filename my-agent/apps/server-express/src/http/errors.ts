import type { NextFunction, Request, Response } from 'express'
import { WorkspaceError } from '../util/workspace.ts'

/**
 * 带状态码的「预期内」错误。
 * 路由里直接 throw，由文件末尾的 error middleware 统一转成 JSON。
 */
export class HttpError extends Error {
    status: number

    constructor(status: number, message: string) {
        super(message)
        this.name = 'HttpError'
        this.status = status
    }
}

/** 连接已经断了就别再写，否则会抛 ERR_STREAM_WRITE_AFTER_END */
export function sendJson(res: Response, status: number, data: unknown): void {
    if (res.writableEnded || res.destroyed) return
    res.status(status).json(data)
}

type BodyParserError = {
    type?: string
    status?: number
    statusCode?: number
    message?: string
}

/**
 * Express 统一错误出口。
 * 注意参数必须是 4 个，否则 Express 不会把它当 error middleware。
 */
export function handleError(
    err: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction,
): void {
    if (res.headersSent) {
        if (!res.writableEnded) res.end()
        return
    }

    if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.message })
        return
    }
    if (err instanceof WorkspaceError) {
        sendJson(res, err.status, { error: err.message })
        return
    }

    // express.json()（body-parser）的报错不是 HttpError，这里翻译成原来的中文提示
    const bodyErr = err as BodyParserError
    if (bodyErr?.type === 'entity.too.large') {
        sendJson(res, 413, { error: '请求体过大' })
        return
    }
    if (bodyErr?.type === 'entity.parse.failed') {
        sendJson(res, 400, { error: '请求体不是合法 JSON' })
        return
    }
    if (bodyErr?.type === 'charset.unsupported' || bodyErr?.type === 'encoding.unsupported') {
        sendJson(res, 415, { error: '不支持的请求体编码' })
        return
    }
    // 其它带 4xx 状态的错误（如 URL 解码失败、content-length 与实际不符）
    const status = bodyErr?.status ?? bodyErr?.statusCode
    if (status && status >= 400 && status < 500) {
        sendJson(res, status, { error: '请求不合法' })
        return
    }

    console.error('请求处理失败:', err)
    sendJson(res, 500, { error: '服务器内部错误' })
}
