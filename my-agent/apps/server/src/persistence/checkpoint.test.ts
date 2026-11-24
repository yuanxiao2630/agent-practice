import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createCheckpointStore, parseCheckpoint, type Checkpoint } from './checkpoint.ts'
import { createTaskState, TaskPhase, TaskStatus } from '../types/task-state.ts'

function exampleCheckpoint(): Checkpoint {
    return {
        version: 1,
        sessionId: 'session-test',
        lastEventSeq: 0,
        savedAt: new Date().toISOString(),
        task: null,
        messages: [{ role: 'system', content: 'test' }],
        workspace: null,
        execution: { model: 'test-model', maxRounds: 10, round: 0, nextAction: 'done', pendingToolCallIds: [] },
    }
}

test('checkpoint：不存在时返回 null，忽略未提交的 tmp 文件', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-checkpoint-'))
    try {
        const store = createCheckpointStore(join(dir, 'checkpoint.json'))
        await writeFile(`${store.file}.tmp`, JSON.stringify(exampleCheckpoint()))
        assert.equal(await store.load(), null)
    } finally { await rm(dir, { recursive: true, force: true }) }
})

test('checkpoint：串行原子保存，入队后修改原对象不影响快照', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-checkpoint-'))
    try {
        const store = createCheckpointStore(join(dir, 'checkpoint.json'))
        const checkpoint = exampleCheckpoint()
        const first = store.save(checkpoint)
        checkpoint.messages.push({ role: 'user', content: 'second' })
        await first
        assert.equal((await store.load())?.messages.length, 1)

        const second = store.save(checkpoint)
        checkpoint.messages.push({ role: 'assistant', content: 'third' })
        const third = store.save(checkpoint)
        await Promise.all([second, third, store.flush()])
        assert.deepEqual((await store.load())?.messages, checkpoint.messages)
        assert.deepEqual(await readdir(dir), ['checkpoint.json'])
    } finally { await rm(dir, { recursive: true, force: true }) }
})

test('checkpoint：损坏、版本错误、字段缺失均报错，原文件保留', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-checkpoint-'))
    try {
        const store = createCheckpointStore(join(dir, 'checkpoint.json'))
        for (const contents of ['{broken', JSON.stringify({ ...exampleCheckpoint(), version: 2 }), '{}']) {
            await writeFile(store.file, contents)
            await assert.rejects(store.load(), /无法恢复 checkpoint/)
            assert.equal(await readFile(store.file, 'utf8'), contents)
        }
    } finally { await rm(dir, { recursive: true, force: true }) }
})

test('checkpoint：写入失败不破坏旧文件，后续写入仍可成功', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-checkpoint-'))
    try {
        const store = createCheckpointStore(join(dir, 'checkpoint.json'))
        await store.save(exampleCheckpoint())
        const original = await readFile(store.file, 'utf8')
        // 用目录占据临时文件路径，确定性模拟写入失败（不依赖当前用户权限）。
        const { mkdir } = await import('node:fs/promises')
        await mkdir(`${store.file}.tmp`)
        await assert.rejects(store.save(exampleCheckpoint()))
        assert.equal(await readFile(store.file, 'utf8'), original)
        await rm(`${store.file}.tmp`, { recursive: true })
        await store.save(exampleCheckpoint())
        assert.ok(await store.load())
    } finally { await rm(dir, { recursive: true, force: true }) }
})

test('checkpoint：拒绝不匹配的 seq、会话、轮次、工具 ID 和非法历史消息', () => {
    assert.throws(() => parseCheckpoint({ ...exampleCheckpoint(), lastEventSeq: 1 }))
    assert.throws(() => parseCheckpoint({ ...exampleCheckpoint(), workspace: '../relative' }))
    assert.throws(() => parseCheckpoint({ ...exampleCheckpoint(), execution: { ...exampleCheckpoint().execution, round: 1 } }))
    assert.throws(() => parseCheckpoint({ ...exampleCheckpoint(), messages: [{ role: 'tool', tool_call_id: 'orphan', content: '' }] }))

    const checkpoint = exampleCheckpoint()
    checkpoint.task = createTaskState('test', undefined, checkpoint.sessionId)
    checkpoint.task.status = TaskStatus.Running
    checkpoint.task.phase = TaskPhase.RunningTools
    checkpoint.execution.nextAction = 'run_tools'
    checkpoint.messages.push({ role: 'assistant', content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'test', arguments: '{}' } }] })
    assert.throws(() => parseCheckpoint(checkpoint), /待执行工具/)
    checkpoint.execution.pendingToolCallIds = ['call-1']
    assert.ok(parseCheckpoint(checkpoint))
    assert.throws(() => parseCheckpoint({ ...checkpoint, sessionId: 'wrong-session' }), /会话不匹配/)
    checkpoint.messages.push({ role: 'user', content: 'invalid before tool receipt' })
    assert.throws(() => parseCheckpoint(checkpoint), /历史工具调用/)
})
