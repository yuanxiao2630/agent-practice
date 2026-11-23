import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentEvent } from '../agent/types.ts'
import { LOG_DIR } from '../config/index.ts'

/**
 * 本地事件日志：一个 session 一个 <sessionId>.jsonl 文件。
 *
 * 只负责追加，不阻塞对话：写盘失败只打日志，不影响 SSE。
 * 同一个文件的写入串成一条 Promise 链，保证行顺序和事件顺序一致。
 */
export type EventLog = {
    append: (event: AgentEvent) => void
    flush: () => Promise<void>
    fileFor: (sessionId: string) => string
}

function safeFileName(sessionId: string): string {
    // sessionId 由服务端生成，这里只是防御：别让异常值带出目录
    return sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')
}

export function createEventLog(dir: string = LOG_DIR): EventLog {
    /** 每个文件一条写入链；所有 append 都挂到链尾，避免并发 append 乱序 */
    const queues = new Map<string, Promise<void>>()

    const fileFor = (sessionId: string): string =>
        join(dir, `${safeFileName(sessionId)}.jsonl`)

    const append = (event: AgentEvent): void => {
        const file = fileFor(event.sessionId)

        let line: string
        try {
            line = `${JSON.stringify(event)}\n`
        } catch (err) {
            console.error('[event-log] 事件无法序列化:', err)
            return
        }

        const previous = queues.get(file) ?? Promise.resolve()
        const next = previous
            .then(async () => {
                await mkdir(dir, { recursive: true })
                await appendFile(file, line, 'utf8')
            })
            .catch((err) => {
                // 日志失败不能反过来打断对话
                console.error(`[event-log] 写入失败 ${file}:`, err)
            })

        queues.set(file, next)
        void next.finally(() => {
            if (queues.get(file) === next) queues.delete(file)
        })
    }

    const flush = async (): Promise<void> => {
        await Promise.all([...queues.values()])
    }

    return { append, flush, fileFor }
}

export const eventLog = createEventLog()
export const appendEvent = eventLog.append
export const flushEventLog = eventLog.flush
