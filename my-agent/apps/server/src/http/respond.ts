import type { ServerResponse } from 'node:http'

/**
 * 带状态码的「预期内」错误。
 * 抛出去由 app.ts 统一转成 JSON，路由里就不必每处 try/catch。
 */
export class HttpError extends Error {
    status: number

    constructor(status: number, message: string) {
        super(message)
        this.name = 'HttpError'
        this.status = status
    }
}

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
    // 连接已经断了就别再写，否则 writeHead 会抛 ERR_STREAM_WRITE_AFTER_END
    if (res.writableEnded || res.destroyed) return

    const body = JSON.stringify(data)
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
    })
    res.end(body)
}
