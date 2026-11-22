import http from 'node:http'
import { HOST } from '../config/index.ts'
import { WorkspaceError } from '../util/workspace.ts'
import { routes } from './routes/index.ts'
import { HttpError, sendJson } from './respond.ts'
import { serveStatic } from './static.ts'

/**
 * 组装 HTTP 服务：静态资源 + API 路由表 + 统一错误出口。
 * 不在这里监听端口、也不初始化 MCP —— 那些是入口 index.ts 的事，
 * 这样测试可以直接 createApp() 起个临时端口，不碰外部网络。
 */
export function createApp(): http.Server {
    return http.createServer(async (req, res) => {
        // host 只用来补全 URL 解析，不影响监听地址
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? HOST}`)

        try {
            // 1. 页面：开发时由 Vite(:5173) 提供，这里只负责构建产物
            if ((req.method === 'GET' || req.method === 'HEAD') && !url.pathname.startsWith('/api')) {
                await serveStatic(url.pathname, res, req.method)
                return
            }

            // 2. API：精确匹配 method + pathname
            const route = routes.find((r) => r.method === req.method && r.path === url.pathname)
            if (!route) {
                // 路径存在但方法不对，给 405 而不是 404，前端排查时能少绕一圈
                const pathExists = routes.some((r) => r.path === url.pathname)
                sendJson(res, pathExists ? 405 : 404, {
                    error: pathExists ? '方法不允许' : 'not found',
                })
                return
            }

            await route.handler({ req, res, url })
        } catch (err) {
            handleError(res, err)
        }
    })
}

/** 预期内的错误按它自带的状态码回；真正没料到的才 500 并打日志 */
function handleError(res: http.ServerResponse, err: unknown): void {
    if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.message })
        return
    }
    if (err instanceof WorkspaceError) {
        sendJson(res, err.status, { error: err.message })
        return
    }

    console.error('请求处理失败:', err)
    if (res.headersSent) {
        if (!res.writableEnded) res.end()
        return
    }
    sendJson(res, 500, { error: '服务器内部错误' })
}
