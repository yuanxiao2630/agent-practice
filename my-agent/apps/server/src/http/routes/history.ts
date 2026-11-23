import {
    getMessages,
    getSessionId,
    isRunning,
    resetMessages,
    taskSnapshot,
} from '../../session.ts'
import { HttpError, sendJson } from '../respond.ts'
import type { Ctx } from './types.ts'

/** 页面回显用：只给「用户说的话」和「模型的最终回答」，工具过程不展示 */
export function historyRoute({ res }: Ctx): void {
    const messages = getMessages()

    const history = messages
        .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content && !m.tool_calls))
        .map((m) => ({ role: m.role, content: m.content }))

    // 最后一条是 user 且当前没在跑：这一问没答完（被中断或报错），前端要标出来
    const interrupted = !isRunning() && history.at(-1)?.role === 'user'

    sendJson(res, 200, { sessionId: getSessionId(), messages: history, interrupted })
}

/** 排查用：服务端真实的上下文（含 tool_calls、中断补的回执）和当前任务状态 */
export function contextRoute({ res }: Ctx): void {
    sendJson(res, 200, {
        sessionId: getSessionId(),
        messages: getMessages(),
        running: isRunning(),
        task: taskSnapshot(),
    })
}

/** 清空上下文（换仓库时会自动清，这里给「重新开始」用） */
export function resetRoute({ res }: Ctx): void {
    if (isRunning()) throw new HttpError(409, 'Agent 正在运行，先中断再清空')

    resetMessages()
    sendJson(res, 200, { ok: true, sessionId: getSessionId() })
}
