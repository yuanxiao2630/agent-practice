import express from 'express'
import type { Express, RequestHandler } from 'express'
import { routes } from './routes/index.ts'
import { readJsonObject } from './body.ts'
import { handleError, sendJson } from './errors.ts'
import { serveWeb } from './static.ts'

/**
 * 组装 Express 应用：API 路由 + 静态资源 + 统一错误出口。
 * 不在这里监听端口、也不初始化 MCP —— 那些是入口 index.ts 的事，
 * 这样测试可以直接 createApp().listen(0) 起个临时端口，不碰外部网络。
 */
export function createApp(): Express {
    const app = express()

    // 别把技术栈暴露在响应头里
    app.disable('x-powered-by')
    // 与原版「method + pathname 精确匹配」保持一致：大小写、末尾斜杠都不放过
    app.set('case sensitive routing', true)
    app.set('strict routing', true)

    // 1. API：逐条注册，POST 需要 body 的再挂 express.json()
    const apiPaths = new Set(routes.map((route) => route.path))

    // Express 默认把 HEAD 当成对应的 GET 处理；原版只注册了 GET，
    // HEAD /api/tools 会落到「方法不允许」。这里显式拦掉，保持行为一致。
    app.use('/api', (req, res, next) => {
        if (req.method !== 'HEAD') {
            next()
            return
        }
        const pathname = req.originalUrl.split('?')[0] ?? ''
        const pathExists = apiPaths.has(pathname)
        sendJson(res, pathExists ? 405 : 404, {
            error: pathExists ? '方法不允许' : 'not found',
        })
    })

    for (const route of routes) {
        const handlers: RequestHandler[] = route.json
            ? [readJsonObject, route.handler]
            : [route.handler]

        switch (route.method) {
            case 'GET':
                app.get(route.path, ...handlers)
                break
            case 'POST':
                app.post(route.path, ...handlers)
                break
            case 'DELETE':
                app.delete(route.path, ...handlers)
                break
        }
    }

    // 2. API 兜底：路径存在但方法不对给 405，而不是笼统的 404，前端排查时能少绕一圈
    app.use('/api', (req, res) => {
        const pathname = req.originalUrl.split('?')[0] ?? ''
        const pathExists = apiPaths.has(pathname)
        sendJson(res, pathExists ? 405 : 404, {
            error: pathExists ? '方法不允许' : 'not found',
        })
    })

    // 3. 页面 + 前端路由兜底（非 /api 的 GET/HEAD）
    serveWeb(app)

    // 4. 统一错误出口，必须放在最后
    app.use(handleError)

    return app
}
