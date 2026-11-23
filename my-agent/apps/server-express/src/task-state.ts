import { randomUUID } from 'node:crypto'

/**
 * 注意：这里不用 `enum`。
 * 项目是 `node apps/server/index.ts` 直接跑 TS，Node 22 默认是「只擦除类型」模式，
 * enum 需要完整转译，import 到它就会 SyntaxError（ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX）。
 * as const 对象 + 派生联合类型，运行时是一个普通对象，行为一样但可擦除。
 */

/** 一次任务的整体状态 */
export const TaskStatus = {
    Pending: 'pending', // 尚未开始
    Running: 'running', // 正在执行
    Completed: 'completed', // 正常结束
    Failed: 'failed', // 因错误停止
    Cancelled: 'cancelled', // 被主动取消
} as const
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus]

/** 任务当前执行到哪个环节 */
export const TaskPhase = {
    ReadyForModel: 'ready_for_model', // 消息已准备好，还没发起本次请求
    CallingModel: 'calling_model', // 已发起请求，正在等待或接收模型返回
    RunningTools: 'running_tools', // 执行模型要求的操作，例如读取文件
    Done: 'done', // 执行结束
} as const
export type TaskPhase = (typeof TaskPhase)[keyof typeof TaskPhase]

/** 一次任务需要记录的信息 */
export type TaskState = {
    /** 这次任务属于哪个对话 session；清空上下文会换新的 sessionId */
    sessionId: string
    taskId: string
    goal: string
    workspace?: string // 这次任务操作文件时以哪个目录为工作目录
    status: TaskStatus
    phase: TaskPhase
    modelCalls: number // 请求模型的次数
    toolCalls: number // 执行工具的次数（失败也算）
    lastError?: string
    cancelReason?: string // 被取消时的原因，和 lastError 分开
    startedAt: string
    endedAt?: string
}

export function createTaskState(
    goal: string,
    workspace: string | undefined,
    sessionId: string,
): TaskState {
    return {
        sessionId,
        taskId: randomUUID(),
        goal,
        workspace,
        status: TaskStatus.Pending,
        phase: TaskPhase.ReadyForModel,
        modelCalls: 0,
        toolCalls: 0,
        startedAt: new Date().toISOString(),
    }
}
