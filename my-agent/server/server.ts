import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMessages, runAgent } from './agent.ts'
import type { AgentEvent } from './agent.ts'
import { initMcp, closeMcp } from './mcp/index.ts'
import { setToolEnabled, setToolsEnabledBySource, toolSnapshot } from './tools/registry.ts'
import { searchBackendInfo, setSearchBackend } from './tools/search-backend.ts'
import {
    emitRoomEvent,
    getRoomSnapshot,
    joinRoomByName,
    leaveParticipant,
    listRooms,
    postMessage,
    subscribe,
    touchParticipant,
} from './rooms/store.ts'
import type { RoomEvent } from './rooms/store.ts'
import { debugDumpRecords, listPeers, localDisplayName, startDiscovery, stopDiscovery } from './rooms/discovery.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env['PORT'] ?? 3000)
// 绑 0.0.0.0：房间功能要求同 WiFi 的其他设备能访问本机 API；
// 这也是「局域网多用户」的前提——127.0.0.1 只允许本机，mDNS 广播出去也没用。
const HOST = '0.0.0.0'

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
process.on('SIGINT',  () => { stopDiscovery(); closeMcp().finally(() => process.exit(0)) })
process.on('SIGTERM', () => { stopDiscovery(); closeMcp().finally(() => process.exit(0)) })

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

/** readJsonBody 的类型化包装：只接受 JSON object，字段用 unknown 再逐个校验 */
async function readJsonObject(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    const data: unknown = await readJsonBody(req)
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('请求体必须是 JSON object')
    }
    return data as Record<string, unknown>
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

        // 3. 工具面板：当前所有工具 + 开关状态 + 搜索后端信息
        if (req.method === 'GET' && url.pathname === '/api/tools') {
            return sendJson(res, 200, { ...toolSnapshot(), searchBackend: searchBackendInfo() })
        }

        // 4. 切换 searchWeb 后端：parallel / deepseek（环境变量锁定或 Agent 运行中时拒绝）
        if (req.method === 'POST' && url.pathname === '/api/search-backend') {
            let body: any
            try {
                body = await readJsonBody(req)
            } catch (err) {
                return sendJson(res, 400, { error: err instanceof Error ? err.message : '请求体解析失败' })
            }

            // 先校验格式再查锁定状态：非法值 400 优先于 409，错误更直接
            const backend = body?.backend
            if (backend !== 'parallel' && backend !== 'deepseek') {
                return sendJson(res, 400, { error: "backend 只能是 'parallel' 或 'deepseek'" })
            }
            if (searchBackendInfo().locked) {
                return sendJson(res, 409, { error: '已由环境变量 LLM_SEARCH_PROVIDER 锁定' })
            }
            // 后端在每轮请求内生效，同一轮前后换后端会让结果来源不一致
            if (busy) return sendJson(res, 409, { error: 'Agent 正在运行，等这一轮结束再调整' })

            setSearchBackend(backend)
            return sendJson(res, 200, { ...toolSnapshot(), searchBackend: searchBackendInfo() })
        }

        // 5. 开关工具：name 传 '*' 表示全部；source 表示整个分组（如 MCP 总开关）
        if (req.method === 'POST' && url.pathname === '/api/tools/toggle') {
            let body: any
            try {
                body = await readJsonBody(req)
            } catch (err) {
                return sendJson(res, 400, { error: err instanceof Error ? err.message : '请求体解析失败' })
            }

            const name = typeof body?.name === 'string' ? body.name.trim() : ''
            const rawSource = body?.source
            const enabled = body?.enabled
            if (typeof enabled !== 'boolean') {
                return sendJson(res, 400, { error: 'enabled 必填' })
            }
            if (rawSource !== undefined && rawSource !== 'builtin' && rawSource !== 'mcp') {
                return sendJson(res, 400, { error: 'source 只能是 builtin 或 mcp' })
            }
            const source = rawSource as 'builtin' | 'mcp' | undefined
            // name 和 source 二选一，避免“看起来两个都传了但只生效一个”的歧义
            if (Boolean(name) === Boolean(source)) {
                return sendJson(res, 400, { error: 'name 和 source 需要且只能传一个' })
            }
            // 工具列表在每轮请求开始时确定，运行中切换会让同一轮前后不一致
            if (busy) return sendJson(res, 409, { error: 'Agent 正在运行，等这一轮结束再调整工具' })

            if (source) {
                if (!setToolsEnabledBySource(source, enabled)) {
                    return sendJson(res, 404, { error: '该分组暂无工具' })
                }
            } else if (!setToolEnabled(name, enabled)) {
                return sendJson(res, 404, { error: `未知工具: ${name}` })
            }
            return sendJson(res, 200, toolSnapshot())
        }

        // ---------- 房间（局域网聊天室） ----------
        // 设计：房间活在本进程内存里，消息走 SSE 推送 + POST 发送（与 /api/chat 同一套模式）。
        // 参与者没有显式登录：name 存 localStorage，服务端按 name+via 记入 participants。

        // 8. 房间列表
        if (req.method === 'GET' && url.pathname === '/api/rooms') {
            return sendJson(res, 200, { rooms: listRooms() })
        }

        // 9. 创建/加入房间：同名房间直接复用（joinRoomByName 内部做 find-or-create）
        if (req.method === 'POST' && url.pathname === '/api/rooms') {
            let body: Record<string, unknown>
            try {
                body = await readJsonObject(req)
            } catch (err) {
                return sendJson(res, 400, { error: err instanceof Error ? err.message : '请求体解析失败' })
            }
            const name = typeof body.name === 'string' ? body.name.trim() : ''
            if (!name) return sendJson(res, 400, { error: 'name 不能为空' })
            return sendJson(res, 200, { room: joinRoomByName(name) })
        }

        // 10. 房间详情 + 最近消息
        // 路径形如 /api/rooms/<id> 或 /api/rooms/<id>/events|messages|join|leave
        if (url.pathname.startsWith('/api/rooms/')) {
            const rest = url.pathname.slice('/api/rooms/'.length)
            const slash = rest.indexOf('/')
            const roomId = slash >= 0 ? rest.slice(0, slash) : rest
            const sub = slash >= 0 ? rest.slice(slash + 1) : ''
            let decodedId: string
            try {
                decodedId = decodeURIComponent(roomId)
            } catch {
                return sendJson(res, 400, { error: '房间 id 编码非法' })
            }

            // 10a. SSE 事件流：snapshot + message/join/leave + 15s 心跳
            if (req.method === 'GET' && sub === 'events') {
                const snapshot = getRoomSnapshot(decodedId)
                if (!snapshot) return sendJson(res, 404, { error: '房间不存在' })

                res.writeHead(200, {
                    'content-type': 'text/event-stream; charset=utf-8',
                    'cache-control': 'no-cache, no-transform',
                    connection: 'keep-alive',
                    'x-accel-buffering': 'no',
                })

                // 订阅前先 touch：打开事件流本身就算「进入房间」；
                // name 用 URL 参数 ?name= 传，没传就不写入参与者列表（匿名围观）
                const who = (url.searchParams.get('name') ?? '').trim().slice(0, 30)
                if (who) {
                    const touch = touchParticipant(decodedId, who, 'user')
                    if (touch?.isNew) {
                        emitRoomEvent(decodedId, { type: 'join', participant: touch.participant })
                    }
                }

                const send = (event: RoomEvent) => {
                    if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`)
                }
                // 先发快照：房间信息 + 最近 50 条消息，前端不用再调 GET /api/rooms/:id
                send({ type: 'snapshot', room: snapshot.room, messages: snapshot.messages })

                const unsubscribe = subscribe(decodedId, send)
                if (!unsubscribe) {
                    res.end()
                    return
                }

                // 心跳注释行：防止中间代理/浏览器把空闲连接掐掉
                const heartbeat = setInterval(() => {
                    if (!res.writableEnded) res.write(': hb\n\n')
                }, 15_000)

                res.on('close', () => {
                    clearInterval(heartbeat)
                    unsubscribe()
                    // leave 事件不在这里广播：浏览器关页没有可靠钩子，
                    // 靠 PARTICIPANT_TTL_MS 自然清理，避免「断线重连」时 leave/join 乱跳
                })
                return
            }

            // 10b. 显式加入/离开（agent 工具和 UI 都可以用，主要给 agent 用）
            if (req.method === 'POST' && (sub === 'join' || sub === 'leave')) {
                let body: Record<string, unknown>
                try {
                    body = await readJsonObject(req)
                } catch (err) {
                    return sendJson(res, 400, { error: err instanceof Error ? err.message : '请求体解析失败' })
                }
                const name = typeof body.name === 'string' ? body.name.trim().slice(0, 30) : ''
                const via = body.via === 'agent' ? 'agent' : 'user'
                if (!name) return sendJson(res, 400, { error: 'name 不能为空' })
                if (sub === 'join') {
                    const touch = touchParticipant(decodedId, name, via)
                    if (!touch) return sendJson(res, 404, { error: '房间不存在' })
                    if (touch.isNew) {
                        emitRoomEvent(decodedId, { type: 'join', participant: touch.participant })
                    }
                    return sendJson(res, 200, { ok: true, participant: touch.participant })
                }
                const existed = leaveParticipant(decodedId, name, via)
                if (!existed) return sendJson(res, 404, { error: '不在房间里' })
                emitRoomEvent(decodedId, { type: 'leave', name })
                return sendJson(res, 200, { ok: true })
            }

            // 10c. 发消息
            if (req.method === 'POST' && sub === 'messages') {
                let body: Record<string, unknown>
                try {
                    body = await readJsonObject(req)
                } catch (err) {
                    return sendJson(res, 400, { error: err instanceof Error ? err.message : '请求体解析失败' })
                }
                const text = typeof body.text === 'string' ? body.text : ''
                if (!text.trim()) return sendJson(res, 400, { error: 'text 不能为空' })
                const name = typeof body.name === 'string' ? body.name : undefined
                // via 由来源决定：UI 传 user，agent 工具传 agent；body.via 仅作兜底
                const via = body.via === 'agent' ? 'agent' : 'user'

                const result = postMessage(decodedId, name, text, via)
                if (!result) return sendJson(res, 404, { error: '房间不存在' })
                if (result.join) {
                    emitRoomEvent(decodedId, { type: 'join', participant: result.join })
                }
                return sendJson(res, 200, { ok: true, message: result.message })
            }

            // 10d. 房间信息（无 sub 或 sub 为空）
            if (req.method === 'GET' && sub === '') {
                const snapshot = getRoomSnapshot(decodedId)
                if (!snapshot) return sendJson(res, 404, { error: '房间不存在' })
                return sendJson(res, 200, snapshot)
            }

            return sendJson(res, 404, { error: 'not found' })
        }

        // 11. 发现的局域网设备：mDNS 浏览结果 + 手动输入兜底
        if (req.method === 'GET' && url.pathname === '/api/peers') {
            const payload: Record<string, unknown> = {
                peers: listPeers(),
                // 把自己也列出来：用户能看到「我自己在哪个 IP/端口」，方便手动分享给别人
                self: {
                    name: localDisplayName(),
                    host: req.socket.localAddress ?? HOST,
                    port: PORT,
                    url: `http://${req.headers.host ?? `${HOST}:${PORT}`}/`,
                },
            }
            // MDNS_DEBUG=1 时附带原始记录，排查发现问题用
            if (process.env['MDNS_DEBUG'] === '1') {
                payload['debug'] = debugDumpRecords()
            }
            return sendJson(res, 200, payload)
        }

        // 6. 清空上下文
        if (req.method === 'POST' && url.pathname === '/api/reset') {
            messages.length = 0
            messages.push(...createMessages())
            return sendJson(res, 200, { ok: true })
        }

        // 7. 提问：SSE 流式返回「第几轮 / 调了什么工具 / 最终回答」
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
    console.log('局域网：同 WiFi 设备可通过 http://<本机IP>:5173（开发）或 :3000（生产）访问')

    // mDNS 广播 + 浏览：告诉同 WiFi 的设备「这里有一个 my-agent 房间服务器」
    // 广播两个端口：5173 是 Vite 开发服务器（HMR 好用），3000 是 API/静态页
    startDiscovery(localDisplayName(), [5173, PORT])
})
