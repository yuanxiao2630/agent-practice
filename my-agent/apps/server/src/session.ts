import { randomUUID } from 'node:crypto'
import { createMessages, sealToolCalls } from './agent/index.ts'
import type { AgentEventBody, ChatMessage } from './agent/types.ts'
import { MAX_ROUNDS, MODEL } from './config/index.ts'
import { checkpointStore, pendingToolCallIds, type Checkpoint, type CheckpointStore } from './persistence/checkpoint.ts'
import { createTaskState, TaskPhase, TaskStatus, type TaskState } from './types/task-state.ts'
import { clearWorkspace, getWorkspace, setWorkspace } from './util/workspace.ts'

// 服务端的会话和任务管理模块，负责保存对话上下文，并记录当前任务的执行状态。
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
let sessionId: string = randomUUID()

let active: ActiveRun | null = null
/** 最近一次结束的任务，给 /api/context 排查用 */
let lastTask: TaskState | null = null
let lastEventSeq = 0
let executionConfig = { model: MODEL, maxRounds: MAX_ROUNDS }

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
export async function resetMessages(): Promise<void> {
    if (active) throw new Error('Agent 正在运行，不能清空上下文')
    // 清空上下文 = 新 session；旧 session 的 jsonl 已经落盘，不会被覆盖
    sessionId = randomUUID()

    messages.length = 0
    messages.push(...createMessages())
    lastTask = null
    lastEventSeq = 0
    executionConfig = { model: MODEL, maxRounds: MAX_ROUNDS }
    await saveCheckpoint()
}

/** 开始一轮：返回它自己的 controller 和任务状态，调用方负责在 finally 里收尾 */
export function beginRun(goal: string): ActiveRun {
    if (active) throw new Error('上一个任务尚未结束')
    const taskInfo = createTaskState(goal, getWorkspace()?.path, sessionId)
    taskInfo.status = TaskStatus.Running

    const run: ActiveRun = { id: taskInfo.taskId, controller: new AbortController(), task: taskInfo }
    active = run
    lastEventSeq = 0
    executionConfig = { model: MODEL, maxRounds: MAX_ROUNDS }
    return run
}

/** 先确定终态；运行锁由 releaseRun 在最终快照写完后释放。 */
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
}

export function releaseRun(run: ActiveRun): void {
    if (active?.id === run.id) active = null
}

export function checkpointSnapshot(): Checkpoint {
    const task = taskSnapshot()
    const pending = pendingToolCallIds(messages)
    const running = task?.status === TaskStatus.Running || task?.status === TaskStatus.Pending
    return {
        version: 1,
        sessionId,
        lastEventSeq,
        savedAt: new Date().toISOString(),
        task,
        messages,
        workspace: getWorkspace()?.path ?? null,
        execution: {
            ...executionConfig,
            round: task?.modelCalls ?? 0,
            nextAction: !running || task?.phase === TaskPhase.Done ? 'done' : pending.length ? 'run_tools' : 'call_model',
            pendingToolCallIds: pending,
        },
    }
}

export async function saveCheckpoint(seq?: number, store: CheckpointStore = checkpointStore): Promise<void> {
    if (seq !== undefined) lastEventSeq = seq
    await store.save(checkpointSnapshot())
}

/** 只恢复对话和现场，绝不启动模型或重跑工具。必须在监听 HTTP 前调用。 */
export async function restoreSession(store: CheckpointStore = checkpointStore): Promise<boolean> {
    if (active) throw new Error('Agent 正在运行，不能恢复 checkpoint')
    const checkpoint = await store.load()
    if (!checkpoint) return false

    clearWorkspace()
    if (checkpoint.workspace) {
        try { await setWorkspace(checkpoint.workspace) } catch (error) {
            console.warn('[checkpoint] 工作区不可用，已取消选择：', error)
            // 保留历史，但不让旧 system 提示词继续宣称可以使用失效目录。
            checkpoint.messages[0] = createMessages(null)[0]
        }
    }
    sessionId = checkpoint.sessionId
    messages.length = 0
    messages.push(...checkpoint.messages)
    lastTask = checkpoint.task
    lastEventSeq = checkpoint.lastEventSeq
    executionConfig = { model: checkpoint.execution.model, maxRounds: checkpoint.execution.maxRounds }
    if (lastTask && (lastTask.status === TaskStatus.Running || lastTask.status === TaskStatus.Pending)) {
        lastTask.status = TaskStatus.Interrupted
        lastTask.phase = TaskPhase.Done
        lastTask.interruptedReason = '服务重启，上次任务未结束'
        lastTask.endedAt = new Date().toISOString()
    }
    sealToolCalls(messages, '服务重启，工具结果未知；未自动重试该工具')
    // 保存封口后的消息和 interrupted，避免每次重启再次修补。
    await saveCheckpoint(undefined, store)
    return true
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
