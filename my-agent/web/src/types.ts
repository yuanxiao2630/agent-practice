// 后端 agent.ts / server.ts 里 ChatMessage 是 any，这里给出页面实际用到的字段
export type ToolCall = {
    id: string
    type: string
    function: { name: string; arguments: string }
}

export type ChatMessage = {
    role: 'system' | 'user' | 'assistant' | 'tool'
    content?: string | null
    tool_calls?: ToolCall[]
    tool_call_id?: string
}

export type AgentEvent =
    | { type: 'round'; round: number; messages: ChatMessage[] }
    | { type: 'tool_start'; round: number; name: string; args: unknown }
    | { type: 'tool_end'; round: number; name: string; content: string }
    | { type: 'final'; rounds: number; content: string; messages?: ChatMessage[] }
    | { type: 'error'; message: string }
    | { type: 'aborted'; message: string }

/** 一轮工具调用的快照：round 事件到达时把 messages 存下来 */
export type RoundSnapshot = {
    round: number
    messages: ChatMessage[]
}

export type ToolSource = 'builtin' | 'mcp'

/** /api/tools 返回的单个工具（含开关状态） */
export type ToolInfo = {
    name: string
    description: string
    source: ToolSource
    enabled: boolean
}

export type StepStatus = 'pending' | 'done' | 'failed'

export type Step = {
    id: string
    name: string
    argsText: string
    status: StepStatus
    note: string
}

export type Turn = {
    id: number
    user: string
    steps: Step[]
    cancelled?: boolean
    assistant?: string
    error?: string
    snapshots: RoundSnapshot[]
    /** final 事件带回来的完整上下文；老版本后端没有该字段时退化为最后一个 round 快照 */
    finalMessages?: ChatMessage[]
}
