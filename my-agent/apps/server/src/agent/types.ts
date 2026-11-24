import type OpenAI from 'openai'
import type { AgentEventBody } from '../../../../shared/events.ts'

/**
 * 工具调用直接从 SDK 的类型里派生，SDK 升级时不会和它脱节。
 * 用 NonNullable<...>[number] 而不是写死 ChatCompletionMessageToolCall，
 * 是因为 SDK 以后可能把 custom tool 也放进这个联合类型。
 */
export type ToolCall = NonNullable<OpenAI.ChatCompletionMessage['tool_calls']>[number]

/** 事件协议在 shared/events.ts，server 和 web 共用同一份定义 */
export type {
    AgentEvent,
    AgentEventBody,
    CancelCause,
    CompletedReason,
    EventMeta,
    ChatMessage,
} from '../../../../shared/events.ts'

export type Emit = (event: AgentEventBody) => void | Promise<void>
