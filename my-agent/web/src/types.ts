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

/** 联网搜索后端：parallel（默认）或 deepseek */
export type SearchBackend = 'parallel' | 'deepseek'

/** /api/tools 附带的搜索后端状态 */
export type SearchBackendInfo = {
    backend: SearchBackend
    /** LLM_SEARCH_PROVIDER 环境变量锁定选择时为 true，UI 需禁用切换 */
    locked: boolean
    deepseekAvailable: boolean
    parallelAvailable: boolean
}

/** /api/tools、/api/tools/toggle、/api/search-backend 共用的响应结构 */
export type ToolsResponse = {
    tools?: ToolInfo[]
    enabled?: number
    total?: number
    searchBackend?: SearchBackendInfo
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
    assistant?: string
    error?: string
    snapshots: RoundSnapshot[]
    /** final 事件带回来的完整上下文；老版本后端没有该字段时退化为最后一个 round 快照 */
    finalMessages?: ChatMessage[]
}

// ---------- 房间（局域网聊天室） ----------

/** GET /api/rooms 返回的房间概要 */
export type RoomInfo = {
    id: string
    name: string
    createdAt: number
    messageCount: number
    participants: string[]
}

/** 单条房间消息 */
export type RoomMessage = {
    id: string
    name: string
    text: string
    via: 'user' | 'agent'
    at: number
}

/** GET /api/rooms/:id 返回：房间信息 + 最近消息 */
export type RoomSnapshot = {
    room: RoomInfo
    messages: RoomMessage[]
}

/** SSE /api/rooms/:id/events 推送的事件 */
export type RoomEvent =
    | { type: 'snapshot'; room: RoomInfo; messages: RoomMessage[] }
    | { type: 'message'; message: RoomMessage }
    | { type: 'join'; participant: { name: string; via: 'user' | 'agent' } }
    | { type: 'leave'; name: string }

/** GET /api/peers 返回的局域网设备 */
export type Peer = {
    name: string
    host: string
    port: number
    url: string
    lastSeen: number
}

/** 本机自检信息 */
export type PeerSelf = {
    name: string
    host: string
    port: number
    url: string
}

export type PeersResponse = {
    peers?: Peer[]
    self?: PeerSelf
}
