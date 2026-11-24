import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import { z } from 'zod'
import type { ChatMessage } from '../agent/types.ts'
import { CHECKPOINT_FILE } from '../config/index.ts'
import { TaskPhase, TaskStatus, type TaskState } from '../types/task-state.ts'

export type Checkpoint = {
    version: 1
    sessionId: string
    /** 现有事件 seq 在 task 内递增，需与 task.taskId 一起定位 JSONL。 */
    lastEventSeq: number
    savedAt: string
    task: TaskState | null
    messages: ChatMessage[]
    workspace: string | null
    execution: {
        model: string
        maxRounds: number
        round: number
        nextAction: 'call_model' | 'run_tools' | 'done'
        pendingToolCallIds: string[]
    }
}

const nonempty = z.string().min(1)
const counter = z.number().int().nonnegative()
const timestamp = z.iso.datetime()
const toolCall = z.discriminatedUnion('type', [
    z.object({ id: nonempty, type: z.literal('function'), function: z.object({ name: nonempty, arguments: z.string() }) }),
    z.object({ id: nonempty, type: z.literal('custom'), custom: z.object({ name: nonempty, input: z.string() }) }),
])
const message = z.discriminatedUnion('role', [
    z.object({ role: z.literal('system'), content: z.string() }),
    z.object({ role: z.literal('user'), content: z.string() }),
    z.object({ role: z.literal('assistant'), content: z.string(), tool_calls: z.array(toolCall).optional() }),
    z.object({ role: z.literal('tool'), tool_call_id: nonempty, content: z.string() }),
])
const task = z.object({
    sessionId: nonempty,
    taskId: nonempty,
    goal: z.string(),
    workspace: z.string().refine(isAbsolute).optional(),
    status: z.enum(TaskStatus),
    phase: z.enum(TaskPhase),
    modelCalls: counter,
    toolCalls: counter,
    lastError: z.string().optional(),
    cancelReason: z.string().optional(),
    interruptedReason: z.string().optional(),
    startedAt: timestamp,
    endedAt: timestamp.optional(),
})
const schema = z.object({
    version: z.literal(1),
    sessionId: nonempty,
    lastEventSeq: counter,
    savedAt: timestamp,
    task: task.nullable(),
    messages: z.array(message).min(1),
    workspace: z.string().refine(isAbsolute).nullable(),
    execution: z.object({
        model: nonempty,
        maxRounds: z.number().int().positive(),
        round: counter,
        nextAction: z.enum(['call_model', 'run_tools', 'done']),
        pendingToolCallIds: z.array(nonempty),
    }),
})

/** 允许最后一批工具尚无回执；历史批次必须完整，不能恢复非法上下文。 */
export function pendingToolCallIds(messages: ChatMessage[]): string[] {
    const pending = new Set<string>()
    for (const message of messages) {
        if (message.role === 'tool') {
            if (!pending.delete(message.tool_call_id)) throw new Error('checkpoint 包含无对应调用或重复的工具回执')
            continue
        }
        if (pending.size > 0) throw new Error('checkpoint 的历史工具调用缺少回执')
        if (message.role === 'assistant') {
            for (const call of message.tool_calls ?? []) {
                if (pending.has(call.id)) throw new Error('checkpoint 包含重复工具调用 ID')
                pending.add(call.id)
            }
        }
    }
    return [...pending]
}

export function parseCheckpoint(value: unknown): Checkpoint {
    const checkpoint = schema.parse(value)
    if (checkpoint.messages[0].role !== 'system') throw new Error('checkpoint 缺少 system 消息')
    if (checkpoint.task && checkpoint.task.sessionId !== checkpoint.sessionId) {
        throw new Error('checkpoint 的任务与会话不匹配')
    }
    if (!checkpoint.task && checkpoint.lastEventSeq !== 0) throw new Error('checkpoint 无任务时 seq 必须为 0')
    if (checkpoint.execution.round !== (checkpoint.task?.modelCalls ?? 0)) throw new Error('checkpoint 的模型轮次不匹配')
    const pending = pendingToolCallIds(checkpoint.messages)
    if (JSON.stringify(pending) !== JSON.stringify(checkpoint.execution.pendingToolCallIds)) {
        throw new Error('checkpoint 的待执行工具与消息不匹配')
    }
    const inProgress = checkpoint.task?.status === TaskStatus.Running || checkpoint.task?.status === TaskStatus.Pending
    const nextAction = !inProgress || checkpoint.task?.phase === TaskPhase.Done ? 'done' : pending.length ? 'run_tools' : 'call_model'
    if (checkpoint.execution.nextAction !== nextAction) throw new Error('checkpoint 的下一步与任务状态不匹配')
    if (!checkpoint.task && pending.length) throw new Error('checkpoint 无任务时不能有待执行工具')
    if (checkpoint.task && !inProgress && (pending.length || checkpoint.task.phase !== TaskPhase.Done || !checkpoint.task.endedAt)) {
        throw new Error('checkpoint 的结束任务不完整')
    }
    return checkpoint
}

export function createCheckpointStore(file = CHECKPOINT_FILE) {
    let queue = Promise.resolve()
    let latest = queue

    const save = (checkpoint: Checkpoint): Promise<void> => {
        // 同步校验和序列化，排队期间消息数组继续变化也不会改变这次快照。
        const data = `${JSON.stringify(parseCheckpoint(checkpoint), null, 2)}\n`
        const next = queue.then(async () => {
            await mkdir(dirname(file), { recursive: true })
            const temporary = `${file}.tmp`
            try {
                const handle = await open(temporary, 'w', 0o600)
                try {
                    await handle.writeFile(data, 'utf8')
                    await handle.sync()
                } finally {
                    await handle.close()
                }
                await rename(temporary, file)
                // rename 的目录项也同步，尽量保证断电后仍能找到新文件。
                const directory = await open(dirname(file), 'r')
                try { await directory.sync() } finally { await directory.close() }
            } finally {
                await rm(temporary, { force: true })
            }
        })
        latest = next
        // 失败仍返回给调用者；队列可继续写，不被一次失败永久堵住。
        queue = next.catch(() => {})
        return next
    }

    const load = async (): Promise<Checkpoint | null> => {
        await queue
        let contents: string
        try { contents = await readFile(file, 'utf8') } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
            throw error
        }
        // 不使用 .tmp，也不回放 JSONL。损坏文件保留原样并明确报错。
        try { return parseCheckpoint(JSON.parse(contents)) } catch (error) {
            throw new Error(`无法恢复 checkpoint：${file}`, { cause: error })
        }
    }

    return { file, save, load, flush: () => latest }
}

export type CheckpointStore = ReturnType<typeof createCheckpointStore>
export const checkpointStore = createCheckpointStore()
