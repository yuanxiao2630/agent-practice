/**
 * 网页模式：起一个本地小服务，浏览器里输入问题，服务端把内容塞进 user 消息。
 *   npm run web        默认 http://127.0.0.1:3000
 *   PORT=4000 npm run web
 */
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMessages, runAgent } from './agent.ts'
import type { AgentEvent } from './agent.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env['PORT'] ?? 3000)
const HOST = '127.0.0.1'

// 单用户本地练习，一份全局上下文就够了（多轮对话会保留工具调用过程）
const messages = createMessages()
let busy = false

function sendJson(res: http.ServerResponse, status: number, data: unknown) {
    const body = JSON.stringify(data)
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(body)
}

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
    const chunks: Buffer[] = []
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
        // 1. 页面
        if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
            const html = await fs.readFile(path.join(here, 'public', 'index.html'))
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            res.end(html)
            return
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
    console.log(`网页版已启动: http://${HOST}:${PORT}`)
    console.log('在浏览器里输入问题，回车发送；Ctrl+C 停止服务')
})
