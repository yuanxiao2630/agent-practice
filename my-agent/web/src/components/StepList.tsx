import type { Step } from '../types.ts'

export default function StepList({ steps }: { steps: Step[] }) {
    return (
        <div className="steps">
            {steps.map((step) => (
                <div key={step.id} className={`step ${step.status}`}>
                    <span className="icon">
                        {step.status === 'pending' ? '⋯' : step.status === 'done' ? '✓' : '✗'}
                    </span>
                    <span className="name">{step.name}</span>
                    <span className="args">{step.status === 'pending' ? step.argsText : step.note}</span>
                </div>
            ))}
        </div>
    )
}
