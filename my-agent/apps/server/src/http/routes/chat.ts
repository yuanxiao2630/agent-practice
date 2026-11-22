import { abortError, isAbortError, runAgent, sealToolCalls } from '../../agent/index.ts'
import type { AgentEvent } from '../../agent/types.ts'
import {
    beginRun,
    currentRun,
    finishRun,
    getMessages,
    isRunning,
    trackEvent,
} from '../../session.ts'
import { TaskStatus } from '../../task-state.ts'
import { readJsonObject } from '../body.ts'
import { HttpError, sendJson } from '../respond.ts'
import { startSse } from '../sse.ts'
import type { Ctx } from './types.ts'

/**
 * 提问：SSE 流式返回「第几轮 / 调了什么工具 / 最终回答」。
 * 同一时刻只允许一轮（单用户本地），靠 isRunning 挡住并发。
 */
export async function chatRoute({ req, res }: Ctx): Promise<void> {
    const body = await readJsonObject(req)
    const text = String(body['message'] ?? '').trim()
    if (!text) throw new HttpError(400, 'message 不能为空')
    if (isRunning()) throw new HttpError(409, '上一个问题还在处理，请稍等')

    // 没选工作区也允许普通对话；文件工具执行时会返回「未选择工作区」给模型
    const messages = getMessages()
    const run = beginRun(text)
    const sse = startSse(res)

    // 中断事件要告诉前端「停在第几轮」，顺手也给后续恢复留一个 id
    let round = 0
    const emit = (event: AgentEvent) => {
        if (event.type === 'round') round = event.round
        trackEvent(run, event)
        sse.send(event)
    }

    // 浏览器刷新 / 关标签 / 前端 abort：连接一断就停止本轮
    res.on('close', () => {
        if (!res.writableEnded) run.controller.abort(abortError('客户端断开'))
    })

    // 用户输入 -> user 消息（这行就是「把页面输入塞给 content」的地方）
    messages.push({ role: 'user', content: text })

    try {
        await runAgent(messages, emit, run.controller.signal)
        finishRun(run, TaskStatus.Completed)
    } catch (err) {
        if (isAbortError(err, run.controller.signal)) {
            const reason = (run.controller.signal.reason as Error | undefined)?.message ?? '已中断'
            // 只补缺的回执，不删已有记录：这一轮留在 messages 里可查
            sealToolCalls(messages, `用户中断，该工具没有返回结果（${reason}）`)
            emit({ type: 'aborted', round, reason, runId: run.id })
            finishRun(run, TaskStatus.Cancelled, reason)
        } else {
            const message = err instanceof Error ? err.message : String(err)
            sealToolCalls(messages, `执行失败，该工具没有返回结果（${message}）`)
            emit({ type: 'error', message })
            finishRun(run, TaskStatus.Failed, message)
        }
    } finally {
        sse.end()
    }
}

/** 中断当前这一轮（幂等：重复调用只是再 abort 一次） */
export function cancelChatRoute({ res }: Ctx): void {
    const run = currentRun()
    if (!run) {
        sendJson(res, 200, { ok: true, cancelled: false })
        return
    }

    run.controller.abort(abortError('用户中断'))
    sendJson(res, 200, { ok: true, cancelled: true, runId: run.id })
}
