import type { Step } from '../types.ts'

// 中断和失败要区分开：一个是「用户不跑了」，一个是「跑错了」
const ICON: Record<Step['status'], string> = {
    pending: '⋯',
    done: '✓',
    failed: '✗',
    cancelled: '⊘',
}

export default function StepList({ steps }: { steps: Step[] }) {
    return (
        <div className="steps">
            {steps.map((step) => (
                <div key={step.id} className={`step ${step.status}`}>
                    <span className="icon">{ICON[step.status]}</span>
                    <span className="name">{step.name}</span>
                    <span className="args">{step.status === 'pending' ? step.argsText : step.note}</span>
                </div>
            ))}
        </div>
    )
}
