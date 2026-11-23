import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
    getMessages,
    getSessionId,
    resetMessages,
    trackEvent,
    type ActiveRun,
} from './session.ts'
import { createTaskState, TaskPhase, TaskStatus } from './types/task-state.ts'

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

test('resetMessages：清空上下文会换一个新的 sessionId', () => {
    const before = getSessionId()

    resetMessages()

    assert.notEqual(getSessionId(), before)
    assert.equal(getMessages().length, 1)
    assert.equal(getMessages()[0]?.role, 'system')
})
