import type { Request, Response } from 'express'
import {
    abortCauseOf,
    abortError,
    isAbortError,
    runAgent,
    sealToolCalls,
} from '../../agent/index.ts'
import { enabledToolDefinitions } from '../../agent/tools/index.ts'
import type { AgentEvent, AgentEventBody } from '../../agent/types.ts'
import {
    beginRun,
    currentRun,
    finishRun,
    getMessages,
    isRunning,
    trackEvent,
} from '../../session.ts'
import { TaskStatus } from '../../task-state.ts'
import { bodyOf } from '../body.ts'
import { HttpError, sendJson } from '../errors.ts'
import { startSse } from '../sse.ts'
import type { RouteHandler } from './types.ts'

/**
 * 提问：SSE 流式返回任务生命周期（task/model/tool 事件）。
 * 同一时刻只允许一轮（单用户本地），靠 isRunning 挡住并发。
 */
export const chatRoute: RouteHandler = async (req, res) => {
    const body = bodyOf(req)
    const text = String(body['message'] ?? '').trim()
    if (!text) throw new HttpError(400, 'message 不能为空')
    if (isRunning()) throw new HttpError(409, '上一个问题还在处理，请稍等')

    // 没选工作区也允许普通对话；文件工具执行时会返回「未选择工作区」给模型
    const messages = getMessages()
    const run = beginRun(text)
    const sse = startSse(res)

    // 信封统一在这里补：agent 只负责业务事件，不需要知道 taskId/seq
    let seq = 0
    const emit = (event: AgentEventBody) => {
        const full: AgentEvent = {
            ...event,
            taskId: run.id,
            seq: ++seq,
            at: new Date().toISOString(),
        }
        trackEvent(run, event)
        sse.send(full)
    }

    // 浏览器刷新 / 关标签 / 前端 abort：连接一断就停止本轮
    res.on('close', () => {
        if (!res.writableEnded) {
            run.controller.abort(abortError('客户端断开', 'client_disconnect'))
        }
    })

    // 用户输入 -> user 消息（这行就是「把页面输入塞给 content」的地方）
    messages.push({ role: 'user', content: text })

    try {
        // 本次 run 实际发给模型的工具；和 task.start 用的是同一份
        const activeTools = enabledToolDefinitions()
        emit({
            type: 'task.start',
            goal: text,
            workspace: run.task.workspace,
            tools: activeTools,
        })

        const result = await runAgent(messages, emit, run.controller.signal, activeTools)

        finishRun(run, TaskStatus.Completed)
        emit({
            type: 'task.completed',
            rounds: result.rounds,
            reason: result.reason,
            content: result.content,
            messages,
        })
    } catch (err) {
        if (isAbortError(err, run.controller.signal)) {
            const reasonErr = run.controller.signal.reason as Error | undefined
            const reason = reasonErr?.message ?? '已中断'
            const cause = abortCauseOf(reasonErr ?? err)

            // 只补缺的回执，不删已有记录：这一轮留在 messages 里可查
            sealToolCalls(messages, `本轮中断，该工具没有返回结果（${reason}）`)

            finishRun(run, TaskStatus.Cancelled, { cancelReason: reason })
            emit({
                type: 'task.cancelled',
                rounds: run.task.modelCalls,
                reason,
                cause,
                messages,
            })
        } else {
            const message = err instanceof Error ? err.message : String(err)
            sealToolCalls(messages, `执行失败，该工具没有返回结果（${message}）`)

            finishRun(run, TaskStatus.Failed, { error: message })
            emit({
                type: 'task.failed',
                rounds: run.task.modelCalls,
                error: message,
                messages,
            })
        }
    } finally {
        sse.end()
    }
}

/** 中断当前这一轮（幂等：重复调用只是再 abort 一次） */
export function cancelChatRoute(_req: Request, res: Response): void {
    const run = currentRun()
    if (!run) {
        sendJson(res, 200, { ok: true, cancelled: false })
        return
    }

    run.controller.abort(abortError('用户中断', 'user'))
    sendJson(res, 200, { ok: true, cancelled: true, runId: run.id })
}
