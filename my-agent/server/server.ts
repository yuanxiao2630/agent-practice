import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMessages, runAgent } from './agent.ts'
import type { AgentEvent } from './agent.ts'
import { initMcp, closeMcp } from './mcp/index.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env['PORT'] ?? 3000)
const HOST = '127.0.0.1'

// Vite 构建产物。开发时页面由 Vite(:5173) 提供，这里读不到也不影响
const WEB_DIST = path.join(here, '../web/dist')

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

/** 托管 web/dist：命中文件就直接返回，否则回 index.html 交给前端路由 */
async function serveWeb(pathname: string, res: http.ServerResponse) {
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
    const filePath = path.resolve(WEB_DIST, rel)

    // 防目录穿越：解析后必须仍在 dist 内
    if (!filePath.startsWith(WEB_DIST + path.sep)) {
        res.writeHead(403)
        res.end()
        return
    }

    const send = async (p: string) => {
        const data = await fs.readFile(p)
        res.writeHead(200, {
            'content-type': MIME[path.extname(p).toLowerCase()] ?? 'application/octet-stream',
            'cache-control': 'no-cache',
        })
        res.end(data)
    }

    try {
        await send(filePath)
    } catch {
        // 带扩展名的请求是静态资源，找不到就 404；
        // 只有 / 这种前端路由才回 index.html，否则浏览器会把 HTML 当 JS 解析
        if (path.extname(filePath)) {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('not found')
            return
        }
        try {
            await send(path.join(WEB_DIST, 'index.html'))
        } catch {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('前端产物不存在：先运行 npm run build，或开发时访问 http://127.0.0.1:5173')
        }
    }
}

// server.ts（常驻进程）
await initMcp()
process.on('SIGINT',  () => closeMcp().finally(() => process.exit(0)))
process.on('SIGTERM', () => closeMcp().finally(() => process.exit(0)))

// 单用户本地练习，一份全局上下文就够了（多轮对话会保留工具调用过程）
const messages = createMessages()
let busy = false // 进程级互斥锁，防止多处同时修改 message 字段

function sendJson(res: http.ServerResponse, status: number, data: unknown) {
    const body = JSON.stringify(data)
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(body)
}

async function readJsonBody(req: http.IncomingMessage): Promise<any> {    
    const chunks: Buffer[] = []
    // 底层就是自动监听 `end`：循环在 `end` 到来时自动结束。
    for await (const chunk of req) {
        chunks.push(chunk as Buffer)
        // 防止误传超大 body
        if (Buffer.concat(chunks).length > 1_000_000) throw new Error('请求体过大')
    }
    if (chunks.length === 0) return {}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? HOST}`)

    try {
        // 1. 页面：开发时由 Vite(:5173) 提供，这里只负责构建产物
        if (req.method === 'GET' && !url.pathname.startsWith('/api')) {
            return serveWeb(url.pathname, res)
        }

        // 2. 历史对话（只回显 user / assistant 的文本，工具过程不展示）
        if (req.method === 'GET' && url.pathname === '/api/history') {
            // 只回显「用户说的话」和「模型的最终回答」；
            // 带 tool_calls 的 assistant 消息（里面有“我先看一下…”之类的过程话术）不展示
            const history = messages
                .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content && !m.tool_calls))
                .map((m) => ({ role: m.role, content: m.content }))
            return sendJson(res, 200, { messages: history })
        }

        // 3. 清空上下文
        if (req.method === 'POST' && url.pathname === '/api/reset') {
            messages.length = 0
            messages.push(...createMessages())
            return sendJson(res, 200, { ok: true })
        }

        // 4. 提问：SSE 流式返回「第几轮 / 调了什么工具 / 最终回答」
        if (req.method === 'POST' && url.pathname === '/api/chat') {
            let body: any
            try {
                body = await readJsonBody(req)
            } catch (err) {
                return sendJson(res, 400, { error: err instanceof Error ? err.message : '请求体解析失败' })
            }

            const text = String(body?.message ?? '').trim()
            if (!text) return sendJson(res, 400, { error: 'message 不能为空' })
            if (busy) return sendJson(res, 409, { error: '上一个问题还在处理，请稍等' })

            busy = true
            res.writeHead(200, {
                'content-type': 'text/event-stream; charset=utf-8',
                'cache-control': 'no-cache, no-transform',
                connection: 'keep-alive',
                'x-accel-buffering': 'no',
            })

            const emit = (event: AgentEvent) => {
                res.write(`data: ${JSON.stringify(event)}\n\n`)
            }

            // 用户输入 -> user 消息（这行就是「把页面输入塞给 content」的地方）
            messages.push({ role: 'user', content: text })

            try {
                await runAgent(messages, emit)
            } catch (err) {
                emit({ type: 'error', message: err instanceof Error ? err.message : String(err) })
            } finally {
                res.write('data: [DONE]\n\n')
                res.end()
                busy = false
            }
            return
        }

        sendJson(res, 404, { error: 'not found' })
    } catch (err) {
        console.error('请求处理失败:', err)
        if (!res.headersSent) sendJson(res, 500, { error: '服务器内部错误' })
        else res.end()
    }
})

server.listen(PORT, HOST, () => {
    console.log(`API 已启动: http://${HOST}:${PORT}`)
    console.log('开发：先 npm run dev，然后访问 http://127.0.0.1:5173')
    console.log('生产：先 npm run build，然后访问上面这个 API 地址')
})
