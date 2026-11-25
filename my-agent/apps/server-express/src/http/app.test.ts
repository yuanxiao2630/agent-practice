import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import { createApp } from './app.ts'

/**
 * 路由层集成测试：createApp 不初始化 MCP、不连模型，
 * 所以可以起在 0 号端口上直接打，跑完不影响任何外部状态。
 */
const app = createApp()
let server: Server
let base = ''

before(async () => {
    await new Promise<void>((resolve, reject) => {
        server = app.listen(0, '127.0.0.1', (error?: Error) => {
            if (error) reject(error)
            else resolve()
        })
    })
    const address = server.address() as AddressInfo
    base = `http://127.0.0.1:${address.port}`
})

after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
})

async function getJson(path: string) {
    const res = await fetch(`${base}${path}`)
    return { res, data: (await res.json()) as any }
}

function postJson(path: string, body: unknown) {
    return fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    })
}

test('GET /api/history：返回消息数组和中断标记', async () => {
    const { res, data } = await getJson('/api/history')
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(data.messages))
    assert.equal(typeof data.interrupted, 'boolean')
})

test('GET /api/context：返回真实上下文、运行状态和任务快照', async () => {
    const { res, data } = await getJson('/api/context')
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(data.messages))
    assert.equal(data.messages[0]?.role, 'system')
    assert.equal(typeof data.running, 'boolean')
    assert.equal(data.task, null)
})

test('GET /api/tools：内置工具都在，且默认全开', async () => {
    const { res, data } = await getJson('/api/tools')
    assert.equal(res.status, 200)

    const names = data.tools.map((t: { name: string }) => t.name)
    for (const name of ['readFileContent', 'findFunctionLine', 'listWorkspaceEntries', 'searchWeb']) {
        assert.ok(names.includes(name), `缺少内置工具 ${name}`)
    }
    assert.equal(data.enabled, data.total)
})

test('POST /api/tools/toggle：未知工具 404，缺 enabled 400', async () => {
    const unknown = await postJson('/api/tools/toggle', { name: 'noSuchTool', enabled: false })
    assert.equal(unknown.status, 404)

    const missing = await postJson('/api/tools/toggle', { name: 'searchWeb' })
    assert.equal(missing.status, 400)
})

test('POST /api/tools/toggle：关掉再打开，快照同步', async () => {
    const toggle = (enabled: boolean) => postJson('/api/tools/toggle', { name: 'searchWeb', enabled })

    const off = await toggle(false)
    assert.equal(off.status, 200)
    const offData = (await off.json()) as any
    assert.equal(offData.tools.find((t: any) => t.name === 'searchWeb').enabled, false)

    const on = await toggle(true)
    assert.equal(on.status, 200)
    const onData = (await on.json()) as any
    assert.equal(onData.tools.find((t: any) => t.name === 'searchWeb').enabled, true)
})

test('POST /api/chat：空消息 400，非法 JSON 400', async () => {
    const empty = await postJson('/api/chat', { message: '   ' })
    assert.equal(empty.status, 400)

    const broken = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{oops',
    })
    assert.equal(broken.status, 400)
    assert.equal(((await broken.json()) as any).error, '请求体不是合法 JSON')
})

test('POST /api/chat：stream 必须是布尔值', async () => {
    const res = await postJson('/api/chat', { message: '你好', stream: 'yes' })
    assert.equal(res.status, 400)
    assert.equal(((await res.json()) as any).error, 'stream 必须是布尔值')
})

test('POST body 必须是 JSON 对象：数组 400', async () => {
    const array = await postJson('/api/chat', ['hello'])
    assert.equal(array.status, 400)
    assert.equal(((await array.json()) as any).error, '请求体必须是 JSON 对象')
})

test('POST body 超过 BODY_LIMIT：413', async () => {
    const huge = await postJson('/api/chat', { message: 'x'.repeat(1_000_001) })
    assert.equal(huge.status, 413)
    assert.equal(((await huge.json()) as any).error, '请求体过大')
})

test('POST body 不依赖 content-type（与原版行为一致）', async () => {
    const res = await fetch(`${base}/api/tools/toggle`, {
        method: 'POST',
        // fetch 对字符串 body 默认是 text/plain
        body: JSON.stringify({ name: 'searchWeb', enabled: true }),
    })
    assert.equal(res.status, 200)
})

test('POST /api/reset：清空后只剩 system 消息', async () => {
    const res = await fetch(`${base}/api/reset`, { method: 'POST' })
    assert.equal(res.status, 200)

    const { data } = await getJson('/api/context')
    assert.equal(data.messages.length, 1)
    assert.equal(data.messages[0].role, 'system')
})

test('未知路径 404，方法不对 405', async () => {
    const missing = await fetch(`${base}/api/nope`)
    assert.equal(missing.status, 404)

    const wrongMethod = await fetch(`${base}/api/tools`, { method: 'PATCH' })
    assert.equal(wrongMethod.status, 405)
})

test('API 路由精确匹配：末尾多一个斜杠也是 404', async () => {
    const res = await fetch(`${base}/api/tools/`)
    assert.equal(res.status, 404)
})

test('HEAD 不会被 Express 自动当成 GET：与原版一致返回 405', async () => {
    const res = await fetch(`${base}/api/tools`, { method: 'HEAD' })
    assert.equal(res.status, 405)
})

test('GET /api/workspace/browse：可以列出一级目录', async () => {
    const { res, data } = await getJson('/api/workspace/browse')
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(data.entries))
    assert.equal(typeof data.path, 'string')
})

test('静态资源：缺失的带扩展名文件返回 404，而不是 index.html', async () => {
    const res = await fetch(`${base}/assets/definitely-missing.js`)
    assert.equal(res.status, 404)
    assert.match(res.headers.get('content-type') ?? '', /text\/plain/)
})
