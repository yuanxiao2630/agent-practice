import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dataDir = await mkdtemp(join(tmpdir(), 'agent-http-test-'))
process.env.CHECKPOINT_FILE = join(dataDir, 'checkpoint.json')
const { createApp } = await import('./app.ts')

/**
 * 路由层集成测试：createApp 不初始化 MCP、不连模型，
 * 所以可以起在 0 号端口上直接打，跑完不影响任何外部状态。
 */
const app = createApp()
let base = ''

before(async () => {
    await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve))
    const address = app.address() as AddressInfo
    base = `http://127.0.0.1:${address.port}`
})

after(async () => {
    await new Promise<void>((resolve) => app.close(() => resolve()))
    await rm(dataDir, { recursive: true, force: true })
})

async function getJson(path: string) {
    const res = await fetch(`${base}${path}`)
    return { res, data: (await res.json()) as any }
}

test('GET /api/history：返回消息数组、中断标记和 sessionId', async () => {
    const { res, data } = await getJson('/api/history')
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(data.messages))
    assert.equal(typeof data.interrupted, 'boolean')
    assert.equal(typeof data.sessionId, 'string')
})

test('GET /api/context：返回真实上下文、运行状态和任务快照', async () => {
    const { res, data } = await getJson('/api/context')
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(data.messages))
    assert.equal(data.messages[0]?.role, 'system')
    assert.equal(typeof data.running, 'boolean')
    assert.equal(typeof data.sessionId, 'string')
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
    const unknown = await fetch(`${base}/api/tools/toggle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'noSuchTool', enabled: false }),
    })
    assert.equal(unknown.status, 404)

    const missing = await fetch(`${base}/api/tools/toggle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'searchWeb' }),
    })
    assert.equal(missing.status, 400)
})

test('POST /api/tools/toggle：关掉再打开，快照同步', async () => {
    const toggle = (enabled: boolean) =>
        fetch(`${base}/api/tools/toggle`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'searchWeb', enabled }),
        })

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
    const empty = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: '   ' }),
    })
    assert.equal(empty.status, 400)

    const broken = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{oops',
    })
    assert.equal(broken.status, 400)
})

test('POST /api/chat：stream 必须是布尔值', async () => {
    const res = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: '你好', stream: 'yes' }),
    })
    assert.equal(res.status, 400)
    assert.equal(((await res.json()) as any).error, 'stream 必须是布尔值')
})

test('POST /api/reset：清空后只剩 system 消息，并换新的 sessionId', async () => {
    const before = await getJson('/api/history')

    const res = await fetch(`${base}/api/reset`, { method: 'POST' })
    assert.equal(res.status, 200)

    const after = await getJson('/api/history')
    assert.notEqual(after.data.sessionId, before.data.sessionId)

    const { data } = await getJson('/api/context')
    assert.equal(data.messages.length, 1)
    assert.equal(data.messages[0].role, 'system')
    assert.equal(data.sessionId, after.data.sessionId)
    const checkpoint = JSON.parse(await readFile(process.env.CHECKPOINT_FILE!, 'utf8'))
    assert.equal(checkpoint.sessionId, data.sessionId)
    assert.equal(checkpoint.task, null)
    assert.deepEqual(checkpoint.messages, data.messages)
})

test('未知路径 404，方法不对 405', async () => {
    const missing = await fetch(`${base}/api/nope`)
    assert.equal(missing.status, 404)

    const wrongMethod = await fetch(`${base}/api/tools`, { method: 'PATCH' })
    assert.equal(wrongMethod.status, 405)
})

test('GET /api/workspace/browse：可以列出一级目录', async () => {
    const { res, data } = await getJson('/api/workspace/browse')
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(data.entries))
    assert.equal(typeof data.path, 'string')
})
