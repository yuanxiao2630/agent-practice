import type OpenAI from 'openai'
import type { AgentEventBody } from '../../../../shared/events.ts'

/**
 * 工具调用直接从 SDK 的类型里派生，SDK 升级时不会和它脱节。
 * 用 NonNullable<...>[number] 而不是写死 ChatCompletionMessageToolCall，
 * 是因为 SDK 以后可能把 custom tool 也放进这个联合类型。
 */
export type ToolCall = NonNullable<OpenAI.ChatCompletionMessage['tool_calls']>[number]

/**
 * 一次会话上下文里的一条消息。
 *
 * 只保留本项目真正会产生的四种角色，比 SDK 的完全版窄。
 * 好处是 sealToolCalls 里的 role 收窄是可靠的，不会漏掉分支。
 */
export type ChatMessage =
    | { role: 'system'; content: string }
    | { role: 'user'; content: string }
    | { role: 'assistant'; content: string; tool_calls?: ToolCall[] }
    | { role: 'tool'; tool_call_id: string; content: string }

/** 事件协议在 shared/events.ts，server 和 web 共用同一份定义 */
export type {
    AgentEvent,
    AgentEventBody,
    CancelCause,
    CompletedReason,
    EventMeta,
} from '../../../../shared/events.ts'

export type Emit = (event: AgentEventBody) => void | Promise<void>
