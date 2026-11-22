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
    | { type: 'aborted'; round: number; reason: string; runId?: string }

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

export type StepStatus = 'pending' | 'done' | 'failed' | 'cancelled'

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
    /** 中断原因（用户中断 / 客户端断开） */
    cancelReason?: string
    assistant?: string
    error?: string
    snapshots: RoundSnapshot[]
    /** final 事件带回来的完整上下文；老版本后端没有该字段时退化为最后一个 round 快照 */
    finalMessages?: ChatMessage[]
}

/** 本次会话选中的仓库目录 */
export type WorkspaceInfo = {
    path: string
    name: string
}

export type WorkspaceShortcut = {
    label: string
    path: string
}

/** /api/workspace/browse 返回的一级目录 */
export type BrowseEntry = {
    name: string
    path: string
    hidden: boolean
    isGitRepo: boolean
}

export type BrowseResult = {
    path: string
    parent: string | null
    entries: BrowseEntry[]
    shortcuts: WorkspaceShortcut[]
    isGitRepo: boolean
    workspace: WorkspaceInfo | null
}

export type SelectWorkspaceResult = {
    workspace: WorkspaceInfo
    /** 换了不同目录：服务端已清空上下文，前端也要清空消息 */
    reset: boolean
}
