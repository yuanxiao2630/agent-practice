import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ActiveRun } from './session.ts'
import { createTaskState, TaskPhase, TaskStatus } from './types/task-state.ts'

const dataDir = await mkdtemp(join(tmpdir(), 'agent-session-test-'))
process.env.CHECKPOINT_FILE = join(dataDir, 'checkpoint.json')
const {
    beginRun,
    currentRun,
    finishRun,
    getMessages,
    getSessionId,
    isRunning,
    releaseRun,
    resetMessages,
    restoreSession,
    saveCheckpoint,
    taskSnapshot,
    trackEvent,
} = await import('./session.ts')
const { checkpointStore } = await import('./persistence/checkpoint.ts')
const { clearWorkspace, getWorkspace, setWorkspace } = await import('./util/workspace.ts')
after(async () => { await checkpointStore.flush(); await rm(dataDir, { recursive: true, force: true }) })

function makeRun(): ActiveRun {
    const task = createTaskState('测试任务', undefined, 'test-session')
    task.status = TaskStatus.Running
    return { id: task.taskId, controller: new AbortController(), task }
}

test('trackEvent：model/tool 计数和 phase 跟着事件走', () => {
    const run = makeRun()

    trackEvent(run, { type: 'task.start', goal: '测试任务', tools: [] })
    trackEvent(run, { type: 'model.start', round: 1, messages: [] })
    trackEvent(run, {
        type: 'model.end',
        round: 1,
        finishReason: 'tool_calls',
        content: '',
        toolCallCount: 1,
        durationMs: 10,
    })
    trackEvent(run, {
        type: 'tool.start',
        round: 1,
        toolCallId: 'call_1',
        name: 'readFileContent',
        args: { filePath: 'a.ts' },
    })
    trackEvent(run, {
        type: 'tool.end',
        round: 1,
        toolCallId: 'call_1',
        name: 'readFileContent',
        status: 'done',
        content: 'ok',
        durationMs: 5,
    })

    assert.equal(run.task.modelCalls, 1)
    assert.equal(run.task.toolCalls, 1)
    assert.equal(run.task.phase, TaskPhase.RunningTools)
})

test('trackEvent：completed / failed / cancelled 是三种不同的终止态', () => {
    const completed = makeRun()
    trackEvent(completed, {
        type: 'task.completed',
        rounds: 2,
        reason: 'stop',
        content: 'done',
        messages: [],
    })
    assert.equal(completed.task.status, TaskStatus.Completed)
    assert.equal(completed.task.phase, TaskPhase.Done)

    const failed = makeRun()
    trackEvent(failed, {
        type: 'task.failed',
        rounds: 1,
        error: '模型调用失败',
        messages: [],
    })
    assert.equal(failed.task.status, TaskStatus.Failed)
    assert.equal(failed.task.lastError, '模型调用失败')

    const cancelled = makeRun()
    trackEvent(cancelled, {
        type: 'task.cancelled',
        rounds: 1,
        reason: '用户中断',
        cause: 'user',
        messages: [],
    })
    assert.equal(cancelled.task.status, TaskStatus.Cancelled)
    assert.equal(cancelled.task.cancelReason, '用户中断')
    assert.equal(cancelled.task.lastError, undefined)
})

test('resetMessages：清空上下文会换一个新的 sessionId', async () => {
    const before = getSessionId()

    await resetMessages()

    assert.notEqual(getSessionId(), before)
    assert.equal(getMessages().length, 1)
    assert.equal(getMessages()[0]?.role, 'system')
})

test('restoreSession：恢复完整上下文，未结束任务标记 interrupted，补齐缺失回执且不重新执行', async () => {
    await resetMessages()
    const run = beginRun('读取两个文件')
    getMessages().push({ role: 'user', content: '读取两个文件' }, {
        role: 'assistant', content: '', tool_calls: ['a', 'b'].map((id) => ({ id, type: 'function' as const, function: { name: 'readFileContent', arguments: '{}' } })),
    }, { role: 'tool', tool_call_id: 'a', content: '已完成的结果' })
    trackEvent(run, { type: 'model.start', round: 1, messages: getMessages() })
    await saveCheckpoint(4)
    const before = await checkpointStore.load()
    assert.deepEqual(before?.execution.pendingToolCallIds, ['b'])
    assert.equal(before?.execution.nextAction, 'run_tools')

    releaseRun(run) // 模拟进程消失，绝不 finishRun
    assert.equal(await restoreSession(), true)
    assert.equal(getSessionId(), run.task.sessionId)
    assert.equal(taskSnapshot()?.status, TaskStatus.Interrupted)
    assert.equal(taskSnapshot()?.phase, TaskPhase.Done)
    assert.ok(taskSnapshot()?.endedAt)
    assert.equal(isRunning(), false)
    assert.equal(currentRun(), null)
    const receipts = getMessages().filter((m) => m.role === 'tool')
    assert.deepEqual(receipts.map((m) => m.tool_call_id), ['a', 'b'])
    assert.equal(receipts[0].content, '已完成的结果')
    assert.match(receipts[1].content, /未自动重试/)
    const restored = await checkpointStore.load()
    assert.equal(restored?.lastEventSeq, 4)
    assert.equal(restored?.task?.status, TaskStatus.Interrupted)
    assert.equal(restored?.execution.nextAction, 'done')
    assert.deepEqual(restored?.execution.pendingToolCallIds, [])
    const endedAt = taskSnapshot()?.endedAt
    await restoreSession()
    assert.equal(taskSnapshot()?.endedAt, endedAt)
    assert.equal(getMessages().filter((m) => m.role === 'tool').length, 2)

    // 可以开始新任务，而不是自动续跑旧任务。
    const next = beginRun('继续提问')
    assert.notEqual(next.id, run.id)
    finishRun(next, TaskStatus.Cancelled)
    releaseRun(next)
})

test('restoreSession：已结束任务和工作区可恢复，目录失效时取消选择但保留历史', async () => {
    const workspace = await mkdtemp(join(dataDir, 'workspace-'))
    const selected = await setWorkspace(workspace)
    await resetMessages()
    const run = beginRun('完成任务')
    getMessages().push({ role: 'user', content: '完成任务' }, { role: 'assistant', content: '已经完成' })
    finishRun(run, TaskStatus.Completed)
    await saveCheckpoint(3)
    releaseRun(run)
    clearWorkspace()
    await restoreSession()
    assert.equal(getWorkspace()?.path, selected.path)
    assert.equal(taskSnapshot()?.status, TaskStatus.Completed)
    assert.equal(getMessages().at(-1)?.content, '已经完成')

    await rm(workspace, { recursive: true })
    await restoreSession()
    assert.equal(getWorkspace(), null)
    assert.equal(getMessages().at(-1)?.content, '已经完成')
    assert.equal((await checkpointStore.load())?.workspace, null)
})

test('resetMessages：最近任务和持久化上下文一起清空，重启不会复活旧消息', async () => {
    await resetMessages()
    const sessionId = getSessionId()
    assert.equal(taskSnapshot(), null)
    await restoreSession()
    assert.equal(getSessionId(), sessionId)
    assert.equal(taskSnapshot(), null)
    assert.equal(getMessages().length, 1)
    assert.equal((await checkpointStore.load())?.lastEventSeq, 0)
})

test('restoreSession：真实新进程只读取 checkpoint，恢复后不启动任务或调用模型', async () => {
    await resetMessages()
    const run = beginRun('重启恢复测试')
    getMessages().push({ role: 'user', content: '重启恢复测试' }, {
        role: 'assistant', content: '', tool_calls: [{ id: 'unanswered', type: 'function', function: { name: 'readFileContent', arguments: '{}' } }],
    })
    trackEvent(run, { type: 'model.start', round: 1, messages: getMessages() })
    await saveCheckpoint(3)
    releaseRun(run)

    const moduleUrl = new URL('./session.ts', import.meta.url).href
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', `
        const session = await import(${JSON.stringify(moduleUrl)})
        await session.restoreSession()
        console.log('RECOVERY_RESULT=' + JSON.stringify({
            task: session.taskSnapshot(), running: session.isRunning(),
            active: session.currentRun(), messages: session.getMessages(),
        }))
    `], { env: process.env, timeout: 10_000 })
    const restored = JSON.parse(stdout.split('\n').find((line) => line.startsWith('RECOVERY_RESULT='))!.slice('RECOVERY_RESULT='.length))
    assert.equal(restored.task.taskId, run.id)
    assert.equal(restored.task.status, 'interrupted')
    assert.equal(restored.running, false)
    assert.equal(restored.active, null)
    assert.equal(restored.messages.at(-1).tool_call_id, 'unanswered')
    assert.equal((await checkpointStore.load())?.task?.status, 'interrupted')
    await restoreSession()
})
