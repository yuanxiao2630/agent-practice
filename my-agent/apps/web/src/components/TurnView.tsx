import type { Turn } from '../types.ts'
import AssistantBubble from './AssistantBubble.tsx'
import MessageInspector from './MessageInspector.tsx'
import StepList from './StepList.tsx'

export default function TurnView({ turn }: { turn: Turn }) {
    return (
        <div className="turn">
            {turn.user && (
                <div className="msg user">
                    <div className="label">你</div>
                    <div className="bubble user">{turn.user}</div>
                </div>
            )}

            {turn.steps.length > 0 && <StepList steps={turn.steps} />}

            {turn.assistant && (
                <AssistantBubble text={turn.assistant} streaming={turn.streaming} />
            )}

            {turn.cancelled && (
                <div className="msg">
                    <div className="label">已中断</div>
                    <div className="bubble hint">
                        <span>
                            本轮已停止，已经产生的消息和工具结果都保留在上下文里。
                            直接输入下一个问题即可接着聊。
                            {turn.cancelReason === '客户端断开' ? '（连接已断开）' : ''}
                        </span>
                    </div>
                </div>
            )}

            {turn.error && (
                <div className="msg error">
                    <div className="label">错误</div>
                    <div className="bubble error">{turn.error}</div>
                </div>
            )}

            <MessageInspector snapshots={turn.snapshots} finalMessages={turn.finalMessages} />
        </div>
    )
}
