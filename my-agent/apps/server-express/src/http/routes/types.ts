import type { Request, Response } from 'express'

/** 每个路由拿到的请求上下文（Express 已经解析好 query / body） */
export type RouteHandler = (req: Request, res: Response) => Promise<void> | void

export type Route = {
    method: 'GET' | 'POST' | 'DELETE'
    path: string
    handler: RouteHandler
    /** 需要先经过 express.json() 的路由 */
    json?: boolean
}
