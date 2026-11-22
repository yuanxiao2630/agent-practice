import type { ServerResponse } from 'node:http'
import type { AgentEvent } from '../agent/types.ts'

export type SseChannel = {
    /** 发一个事件；连接已断时静默忽略 */
    send: (event: AgentEvent) => void
    /** 补 [DONE] 并关闭 */
    end: () => void
}

/**
 * 把 SSE 的头部和「断了别再写」的判断收在一处。
 * 注意不要在这条连接上挂压缩中间件，否则事件会被 buffer 住，前端要等到结束才看到输出。
 */
export function startSse(res: ServerResponse): SseChannel {
    res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
    })

    return {
        send(event) {
            if (res.writableEnded || res.destroyed) return
            res.write(`data: ${JSON.stringify(event)}\n\n`)
        },
        end() {
            if (res.writableEnded || res.destroyed) return
            res.write('data: [DONE]\n\n')
            res.end()
        },
    }
}
