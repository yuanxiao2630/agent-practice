import type { Response } from 'express'
import type { AgentEvent } from '../agent/types.ts'

export type SseChannel = {
    /** 发一个事件；连接已断时静默忽略 */
    send: (event: AgentEvent) => void
    /** 补 [DONE] 并关闭 */
    end: () => void
}

/**
 * 把 SSE 的头部和「断了别再写」的判断收在一处。
 * Express 的 res 本身就是 http.ServerResponse，所以直接 write 即可；
 * 关键是不要在这条连接上挂压缩中间件，否则事件会被 buffer 住。
 */
export function startSse(res: Response): SseChannel {
    res.status(200)
    res.setHeader('content-type', 'text/event-stream; charset=utf-8')
    res.setHeader('cache-control', 'no-cache, no-transform')
    res.setHeader('connection', 'keep-alive')
    res.setHeader('x-accel-buffering', 'no')
    // 立刻把响应头推给客户端，避免被 Express / 反向代理缓冲
    res.flushHeaders()

    const closed = () => res.writableEnded || res.destroyed

    return {
        send(event) {
            if (closed()) return
            res.write(`data: ${JSON.stringify(event)}\n\n`)
        },
        end() {
            if (closed()) return
            res.write('data: [DONE]\n\n')
            res.end()
        },
    }
}
