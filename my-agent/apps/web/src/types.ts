/**
 * 事件协议在仓库根目录的 shared/events.ts，server 和 web 共用同一份定义。
 * 这里只做转发，页面其他文件继续从 '../types.ts' / './types.ts' import。
 */
import type { ChatMessage } from '../../../shared/events.ts'

export type { AgentEvent, ChatMessage, ToolCall } from '../../../shared/events.ts'

/** 一轮工具调用的快照：model.start 到达时把 messages 存下来 */
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
