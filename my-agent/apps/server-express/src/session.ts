import { randomUUID } from 'node:crypto'
import { createMessages } from './agent/index.ts'
import type { AgentEventBody, ChatMessage } from './agent/types.ts'
import { createTaskState, TaskPhase, TaskStatus, type TaskState } from './task-state.ts'
import { getWorkspace } from './util/workspace.ts'

/**
 * 一次正在跑的任务。
 * 「有没有在跑 / 跑的是谁 / 怎么停 / 跑到哪一步」都在这一个值里，
 * 避免 busy 标志和 controller 各改各的、互相不同步。
 */
export type ActiveRun = {
    id: string
    controller: AbortController
    task: TaskState
}

/**
 * 单用户本地练习：整个进程共用一份上下文。
 * 以后要支持多会话，就把这里换成 Map<sessionId, Session> —— 但那是数据模型改造，
 * 不是命名问题，现在不做。
 */
const messages: ChatMessage[] = createMessages()

/**
 * 一次对话上下文对应一个 sessionId，下面可以跑多个 taskId。
 * 清空上下文（/api/reset、切仓库、取消仓库）时换新的 sessionId。
 */
let sessionId = randomUUID()

let active: ActiveRun | null = null
/** 最近一次结束的任务，给 /api/context 排查用 */
let lastTask: TaskState | null = null

export function getSessionId(): string {
    return sessionId
}

export function getMessages(): ChatMessage[] {
    return messages
}

export function isRunning(): boolean {
    return active !== null
}

export function currentRun(): ActiveRun | null {
    return active
}

export function taskSnapshot(): TaskState | null {
    return active?.task ?? lastTask
}

/** 切换/取消仓库、清空对话时用：旧上下文不能继续用，直接重置 */
export function resetMessages(): void {
    // 清空上下文 = 新 session；旧 session 的 jsonl 已经落盘，不会被覆盖
    sessionId = randomUUID()

    messages.length = 0
    messages.push(...createMessages())
}

/** 开始一轮：返回它自己的 controller 和任务状态，调用方负责在 finally 里收尾 */
export function beginRun(goal: string): ActiveRun {
    const task = createTaskState(goal, getWorkspace()?.path, sessionId)
    task.status = TaskStatus.Running

    const run: ActiveRun = { id: task.taskId, controller: new AbortController(), task }
    active = run
    return run
}

/** 收尾：状态、结束时间落定，并释放「正在跑」的位置 */
export function finishRun(
    run: ActiveRun,
    status: TaskStatus,
    detail?: { error?: string; cancelReason?: string },
): void {
    run.task.status = status
    run.task.phase = TaskPhase.Done
    run.task.endedAt = new Date().toISOString()
    if (detail?.error) run.task.lastError = detail.error
    if (detail?.cancelReason) run.task.cancelReason = detail.cancelReason

    lastTask = run.task
    if (active?.id === run.id) active = null
}

/** 把 agent 事件映射到任务状态，让 /api/context 能看到「现在在调模型还是在跑工具」 */
export function trackEvent(run: ActiveRun, event: AgentEventBody): void {
    const task = run.task

    switch (event.type) {
        case 'task.start':
            task.status = TaskStatus.Running
            task.phase = TaskPhase.ReadyForModel
            break
        case 'model.start':
            task.phase = TaskPhase.CallingModel
            // round 是 1-based 且包含 max_rounds 的总结调用，直接用事件里的值
            task.modelCalls = Math.max(task.modelCalls, event.round)
            break
        case 'model.delta':
            // 增量只影响页面展示，任务状态仍然是「正在调模型」
            task.phase = TaskPhase.CallingModel
            break
        case 'model.end':
            task.phase = event.toolCallCount > 0 ? TaskPhase.RunningTools : TaskPhase.Done
            break
        case 'tool.start':
            task.phase = TaskPhase.RunningTools
            task.toolCalls++
            break
        case 'tool.end':
            break
        case 'task.completed':
            task.status = TaskStatus.Completed
            task.phase = TaskPhase.Done
            break
        case 'task.failed':
            task.status = TaskStatus.Failed
            task.phase = TaskPhase.Done
            task.lastError = event.error
            break
        case 'task.cancelled':
            task.status = TaskStatus.Cancelled
            task.phase = TaskPhase.Done
            task.cancelReason = event.reason
            break
    }
}
