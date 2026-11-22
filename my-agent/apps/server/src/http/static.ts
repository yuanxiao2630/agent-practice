import fs from 'node:fs/promises'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import { WEB_DIST } from '../config/index.ts'

const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
}

const INDEX = path.join(WEB_DIST, 'index.html')
const BUILD_HINT = '前端产物不存在：先运行 npm run build，或开发时访问 http://127.0.0.1:5173'

/**
 * 托管 apps/web/dist。
 * 命中文件就直接返回；带扩展名但找不到的一律 404（否则浏览器会把 HTML 当 JS 解析），
 * 不带扩展名的当作前端路由，回 index.html。
 */
export async function serveStatic(
    pathname: string,
    res: ServerResponse,
    method: string,
): Promise<void> {
    let rel: string
    try {
        rel = decodeURIComponent(pathname)
    } catch {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('bad request')
        return
    }

    const filePath = path.resolve(WEB_DIST, rel === '/' ? 'index.html' : rel.replace(/^\/+/, ''))

    // 防目录穿越：解析后必须仍在 dist 内
    if (filePath !== INDEX && !filePath.startsWith(WEB_DIST + path.sep)) {
        res.writeHead(403)
        res.end()
        return
    }

    const send = async (target: string) => {
        const data = await fs.readFile(target)
        res.writeHead(200, {
            'content-type': MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
            'content-length': data.length,
            'cache-control': 'no-cache',
        })
        res.end(method === 'HEAD' ? undefined : data)
    }

    try {
        await send(filePath)
        return
    } catch {
        // 落到下面的兜底
    }

    if (path.extname(filePath)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('not found')
        return
    }

    try {
        await send(INDEX)
    } catch {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end(BUILD_HINT)
    }
}
