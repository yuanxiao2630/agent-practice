import assert from 'node:assert/strict'
import { createServer, type ServerResponse } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { after, test } from 'node:test'
import type { AgentEvent } from '../agent/types.ts'
import type { Checkpoint } from '../persistence/checkpoint.ts'

// 仅连接本地模型替身，不使用真实 API Key 或外部网络。
const dir = await mkdtemp(join(tmpdir(), 'agent-checkpoint-http-'))
const requests: any[] = []
let respond = (_body: any, res: ServerResponse): void => { res.end('{}') }
const model = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    requests.push(body)
    res.setHeader('content-type', 'application/json')
    respond(body, res)
})
await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve))
process.env.CHECKPOINT_FILE = join(dir, 'checkpoint.json')
process.env.LOG_DIR = join(dir, 'sessions')
process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${(model.address() as AddressInfo).port}`
process.env.DEEPSEEK_API_KEY = 'test-only'
process.env.MAX_ROUNDS = '1'
const { createApp } = await import('./app.ts')
const { checkpointStore } = await import('../persistence/checkpoint.ts')
const { getMessages, isRunning, resetMessages, restoreSession, taskSnapshot } = await import('../session.ts')
const { clearWorkspace, setWorkspace } = await import('../util/workspace.ts')
const app = createApp()
await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`
after(async () => {
    await Promise.all([
        new Promise<void>((resolve) => app.close(() => resolve())),
        new Promise<void>((resolve) => model.close(() => resolve())),
    ])
    await checkpointStore.flush().catch(() => {})
    await rm(dir, { recursive: true, force: true })
})

/** 模型现在统一走流式：用一个最小的 OpenAI SSE 替身，文本和 tool_call 都分片下发 */
function chunk(delta: Record<string, unknown>, finishReason: string | null = null) {
    return {
        id: 'mock-completion',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'mock',
        choices: [{ index: 0, delta, finish_reason: finishReason }],
    }
}

function writeStream(res: ServerResponse, chunks: unknown[]): void {
    res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
    })
    for (const item of chunks) res.write(`data: ${JSON.stringify(item)}\n\n`)
    res.end('data: [DONE]\n\n')
}

function completion(res: ServerResponse, content: string, calls?: any[]) {
    const chunks: unknown[] = []

    // 文本拆成两片，验证 delta 能按到达顺序拼回完整 content
    const mid = Math.floor(content.length / 2)
    for (const piece of [content.slice(0, mid), content.slice(mid)]) {
        if (piece) chunks.push(chunk({ content: piece }))
    }

    if (calls) {
        for (const [index, call] of calls.entries()) {
            const args: string = call.function.arguments
            const split = Math.floor(args.length / 2)
            // id / name 在第一片，arguments 跨两片，覆盖真实流式 tool_call 的形态
            chunks.push(chunk({
                tool_calls: [{
                    index,
                    id: call.id,
                    type: 'function',
                    function: { name: call.function.name, arguments: args.slice(0, split) },
                }],
            }))
            chunks.push(chunk({
                tool_calls: [{ index, function: { arguments: args.slice(split) } }],
            }))
        }
    }

    chunks.push(chunk({}, calls ? 'tool_calls' : 'stop'))
    writeStream(res, chunks)
}

/** 非流式替身：一次返回完整的 chat.completion，不含任何 delta */
function nonStreamCompletion(res: ServerResponse, content: string, calls?: any[]): void {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
        id: 'mock-completion',
        object: 'chat.completion',
        created: 1,
        model: 'mock',
        choices: [{
            index: 0,
            finish_reason: calls ? 'tool_calls' : 'stop',
            message: { role: 'assistant', content, ...(calls ? { tool_calls: calls } : {}) },
        }],
    }))
}

async function chat(message: string, stream?: boolean): Promise<AgentEvent[]> {
    const res = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(stream === undefined ? { message } : { message, stream }),
    })
    assert.equal(res.status, 200)
    return (await res.text()).split('\n\n')
        .filter((line) => line.startsWith('data: {'))
        .map((line) => JSON.parse(line.slice(6)) as AgentEvent)
}

test('chat checkpoint：模型回复和工具回执先入上下文，再保存；总结调用及完成状态也落盘', async (t) => {
    const workspace = join(dir, 'workspace')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(workspace)
    await writeFile(join(workspace, 'hello.txt'), 'hello checkpoint')
    await setWorkspace(workspace)
    await resetMessages()
    requests.length = 0
    const snapshots: Checkpoint[] = []
    const save = checkpointStore.save.bind(checkpointStore)
    t.mock.method(checkpointStore, 'save', async (checkpoint: Checkpoint) => {
        snapshots.push(structuredClone(checkpoint))
        await save(checkpoint)
    })
    respond = (_body, res) => {
        if (requests.length === 1) {
            completion(res, '', ['hello.txt', 'missing.txt'].map((filePath, index) => ({
                id: `call-${index}`, type: 'function', function: { name: 'readFileContent', arguments: JSON.stringify({ filePath }) },
            })))
        } else completion(res, '已总结')
    }

    const events = await chat('读取文件')
    assert.equal(events.at(-1)?.type, 'task.completed')

    // 流式增量：按 round 拼接后应与 model.end 的权威全文一致
    const deltas = events.filter((e) => e.type === 'model.delta')
    assert.ok(deltas.length > 0)
    const streamedText = deltas.map((e) => e.content).join('')
    const finalModelEnd = events.find((e) => e.type === 'model.end' && e.content)
    assert.equal(streamedText, finalModelEnd?.type === 'model.end' ? finalModelEnd.content : '')

    for (const event of events) {
        // 瞬时增量不落盘：不应为它保存 checkpoint
        if (event.type === 'model.delta') {
            assert.equal(snapshots.some((s) => s.lastEventSeq === event.seq), false)
            continue
        }
        const snapshot = snapshots.find((s) => s.lastEventSeq === event.seq)
        assert.ok(snapshot)
        if (event.type === 'model.end' && event.toolCallCount > 0) {
            assert.equal(snapshot.messages.at(-1)?.role, 'assistant')
            assert.deepEqual(snapshot.execution.pendingToolCallIds, ['call-0', 'call-1'])
        }
        if (event.type === 'tool.end') {
            const receipt = snapshot.messages.find((m) => m.role === 'tool' && m.tool_call_id === event.toolCallId)
            assert.equal(receipt?.content, event.content)
        }
    }
    assert.ok(events.some((e) => e.type === 'tool.end' && e.status === 'failed'))
    const checkpoint = await checkpointStore.load()
    assert.equal(checkpoint?.task?.status, 'completed')
    assert.equal(checkpoint?.task?.modelCalls, 2)
    assert.equal(checkpoint?.task?.toolCalls, 2)
    assert.equal(checkpoint?.execution.nextAction, 'done')
    assert.equal(checkpoint?.lastEventSeq, events.at(-1)?.seq)
    assert.equal(checkpoint?.messages.at(-1)?.content, '已总结')
    assert.equal(requests[0]?.stream, true)
    assert.equal(requests[1].tools, undefined)
    assert.equal(isRunning(), false)
    const log = await readFile(join(process.env.LOG_DIR!, `${checkpoint?.sessionId}.jsonl`), 'utf8')
    const loggedTypes = log.trim().split('\n').map((line) => JSON.parse(line).type)
    assert.deepEqual(
        loggedTypes,
        events.filter((event) => event.type !== 'model.delta').map((event) => event.type),
    )
    await restoreSession()
    assert.equal(taskSnapshot()?.status, 'completed')
    assert.equal(getMessages().at(-1)?.content, '已总结')
})

test('chat checkpoint：stream=false 时走非流式，工具调用和最终回答仍完整', async () => {
    const workspace = join(dir, 'workspace')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(workspace, { recursive: true })
    await writeFile(join(workspace, 'hello.txt'), 'hello checkpoint')
    await setWorkspace(workspace)
    await resetMessages()
    requests.length = 0
    respond = (_body, res) => {
        if (requests.length === 1) {
            nonStreamCompletion(res, '', [{
                id: 'call-ns',
                type: 'function',
                function: { name: 'readFileContent', arguments: JSON.stringify({ filePath: 'hello.txt' }) },
            }])
        } else {
            nonStreamCompletion(res, '非流式总结')
        }
    }

    const events = await chat('非流式读取文件', false)
    assert.deepEqual(requests.map((request) => request.stream), [false, false])
    assert.equal(events.some((event) => event.type === 'model.delta'), false)

    const toolEnd = events.find((event) => event.type === 'tool.end')
    assert.equal(toolEnd?.type === 'tool.end' ? toolEnd.status : null, 'done')
    if (toolEnd?.type === 'tool.end') assert.match(toolEnd.content, /hello checkpoint/)

    const end = events.at(-1)
    assert.equal(end?.type, 'task.completed')
    if (end?.type === 'task.completed') assert.equal(end.content, '非流式总结')

    const checkpoint = await checkpointStore.load()
    assert.equal(checkpoint?.task?.status, 'completed')
    assert.equal(checkpoint?.messages.at(-1)?.content, '非流式总结')
    assert.equal(isRunning(), false)
})

test('chat checkpoint：模型失败时保存 failed，运行锁释放', async () => {
    clearWorkspace()
    await resetMessages()
    respond = (_body, res) => {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'mock model failure', type: 'server_error' } }))
    }
    const events = await chat('测试失败')
    assert.equal(events.at(-1)?.type, 'task.failed')
    assert.equal((await checkpointStore.load())?.task?.status, 'failed')
    assert.equal(isRunning(), false)
})

test('chat checkpoint：取消请求保存 cancelled，上下文可以恢复', async () => {
    await resetMessages()
    let reachedModel!: () => void
    const requested = new Promise<void>((resolve) => { reachedModel = resolve })
    respond = (_body, res) => {
        res.on('close', () => res.end())
        reachedModel()
    }
    const pending = chat('等待取消')
    await requested
    const cancelled = await fetch(`${base}/api/chat/cancel`, { method: 'POST' })
    assert.equal(cancelled.status, 200)
    const events = await pending
    assert.equal(events.at(-1)?.type, 'task.cancelled')
    assert.equal((await checkpointStore.load())?.task?.status, 'cancelled')
    assert.equal(isRunning(), false)
    await restoreSession()
    assert.equal(taskSnapshot()?.status, 'cancelled')
    assert.equal(getMessages().at(-1)?.content, '等待取消')
})

test('chat checkpoint：存储故障报告错误，保留上次快照，不再调用模型', async (t) => {
    await resetMessages()
    const before = await readFile(checkpointStore.file, 'utf8')
    requests.length = 0
    t.mock.method(checkpointStore, 'save', async () => { throw new Error('模拟磁盘写满') })
    const events = await chat('无法保存时应停止')
    const last = events.at(-1)
    assert.equal(last?.type, 'task.failed')
    if (last?.type === 'task.failed') assert.match(last.error, /checkpoint 保存失败/)
    assert.equal(requests.length, 0)
    assert.equal(isRunning(), false)
    assert.equal(await readFile(checkpointStore.file, 'utf8'), before)
})

test('workspace checkpoint：切换和取消选择都更新快照及会话', async () => {
    await resetMessages()
    const before = (await checkpointStore.load())?.sessionId
    const selected = await fetch(`${base}/api/workspace`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: join(dir, 'workspace') }),
    })
    assert.equal(selected.status, 200)
    const checkpoint = await checkpointStore.load()
    assert.notEqual(checkpoint?.sessionId, before)
    assert.equal(checkpoint?.task, null)
    assert.ok(checkpoint?.workspace?.endsWith('/workspace'))
    const cleared = await fetch(`${base}/api/workspace`, { method: 'DELETE' })
    assert.equal(cleared.status, 200)
    assert.equal((await checkpointStore.load())?.workspace, null)
})
