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

            {turn.assistant && <AssistantBubble text={turn.assistant} />}

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
