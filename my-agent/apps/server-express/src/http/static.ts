import path from 'node:path'
import express from 'express'
import type { Express } from 'express'
import { WEB_DIST } from '../config/index.ts'
import { sendJson } from './errors.ts'

const INDEX = path.join(WEB_DIST, 'index.html')
const BUILD_HINT = '前端产物不存在：先运行 npm run build，或开发时访问 http://127.0.0.1:5173'

/**
 * 托管 apps/web/dist。
 * 原版手写了 MIME 表、目录穿越校验和 HEAD 处理；
 * 这里换成 express.static + 一个 SPA 兜底：命中文件直接返回，
 * 带扩展名但找不到的一律 404（否则浏览器会把 HTML 当 JS 解析），
 * 不带扩展名的当作前端路由，回 index.html。
 */
export function serveWeb(app: Express): void {
    app.use(
        express.static(WEB_DIST, {
            index: 'index.html',
            // 找不到就交给后面的 SPA 兜底，而不是由 static 直接 404
            fallthrough: true,
            redirect: false,
            etag: false,
            lastModified: false,
            dotfiles: 'allow',
            setHeaders(res) {
                res.setHeader('cache-control', 'no-cache')
            },
        }),
    )

    app.use((req, res) => {
        // 非 GET/HEAD 的未知路径保持原版行为：JSON 404
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            sendJson(res, 404, { error: 'not found' })
            return
        }

        // 带扩展名却没被 static 命中：确实缺文件，别再回 HTML
        if (path.extname(req.path)) {
            res.status(404)
            res.setHeader('content-type', 'text/plain; charset=utf-8')
            res.send('not found')
            return
        }

        res.sendFile(INDEX, { headers: { 'cache-control': 'no-cache' } }, (err) => {
            if (!err) return
            if (res.headersSent) {
                if (!res.writableEnded) res.end()
                return
            }
            res.status(404)
            res.setHeader('content-type', 'text/plain; charset=utf-8')
            res.send(BUILD_HINT)
        })
    })
}
