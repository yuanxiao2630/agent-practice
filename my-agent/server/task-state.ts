import { randomUUID } from 'node:crypto'

// 定义“任务有哪些整体状态”
export enum TaskStatus {
    Pending = 'pending',      // 尚未开始
    Running = 'running',      // 正在执行
    Completed = 'completed',  // 正常结束
    Failed = 'failed',        // 因错误停止
    Cancelled = 'cancelled',  // 被主动取消
}

// 表示“任务当前执行到哪个环节了”
export enum TaskPhase {
    ReadyForModel = 'ready_for_model', // 消息已准备好，还没发起本次请求
    CallingModel = 'calling_model', // 已发起请求，正在等待或接收模型返回
    RunningTools = 'running_tools', // 执行模型要求的操作，例如读取文件
    Done = 'done', // 执行结束
}


// 定义“一个任务需要记录哪些信息”
export interface TaskState {
    taskId: string
    goal: string
    workspace?: string  // 这次任务操作文件、执行命令时，以哪个目录作为工作目录

    status: TaskStatus
    phase: TaskPhase

    modelCalls: number // 请求模型的次数
    toolCalls: number  // 执行工具的次数，失败的调用也会计入
    lastError?: string
}

export function createTaskState(
    goal: string,
    workspace = process.cwd(),
): TaskState {
    return {
        taskId: randomUUID(),
        goal,
        workspace,
        status: TaskStatus.Pending,
        phase: TaskPhase.ReadyForModel,
        modelCalls: 0,
        toolCalls: 0,
    }
}