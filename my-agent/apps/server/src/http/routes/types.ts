import type { IncomingMessage, ServerResponse } from 'node:http'

/** 每个路由拿到的请求上下文 */
export type Ctx = {
    req: IncomingMessage
    res: ServerResponse
    url: URL
}

export type RouteHandler = (ctx: Ctx) => Promise<void> | void

export type Route = {
    method: string
    path: string
    handler: RouteHandler
}
