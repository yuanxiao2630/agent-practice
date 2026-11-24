/**
 * server / web 共用的事件协议。
 *
 * 这里是唯一的一份 AgentEvent：服务端负责发，前端只 import type。
 * 事件按领域分组：
 *   - task.*  一次任务的生命周期
 *   - model.* 每次模型调用
 *   - tool.*  每个工具调用
 *
 * 约定：
 *   - 事件是「已经发生的事实」，终止事件三选一、恰好一次，并且是最后一个业务事件。
 *   - `taskId` / `seq` / `at` 由传输层统一补，agent 只产出 body。
 *   - 快照只放在检查点：`model.start` 和终止事件带 messages，其余事件只带增量。
 */

export type ToolCall =
    | { id: string; type: 'function'; function: { name: string; arguments: string } }
    | { id: string; type: 'custom'; custom: { name: string; input: string }; function?: never }

/** 页面/事件里流通的消息形状；服务端内部可以使用更严格的 SDK 派生类型 */
export type ChatMessage =
    | { role: 'system'; content: string }
    | { role: 'user'; content: string }
    | { role: 'assistant'; content: string; tool_calls?: ToolCall[] }
    | { role: 'tool'; tool_call_id: string; content: string }

/** 和 OpenAI function calling 的形状一致，可以直接塞进 tools 参数 */
export type ToolDefinition = {
    type: 'function'
    function: {
        name: string
        description?: string
        parameters?: Record<string, unknown>
    }
}

/** 每次 run 的公共信封 */
export type EventMeta = {
    /** 一次对话上下文；清空上下文会换新的 sessionId */
    sessionId: string
    taskId: string
    /** 同一个 task 内从 1 开始单调递增 */
    seq: number
    /** ISO 时间 */
    at: string
}

export type CompletedReason = 'stop' | 'max_rounds' | 'empty_tool_calls' | 'other'

export type CancelCause = 'user' | 'client_disconnect' | 'server_shutdown'

/** agent / route 产出的业务事件，不含信封 */
export type AgentEventBody =
    // 任务开始：只带元信息；首条 model.start 会带初始 messages
    | {
          type: 'task.start'
          goal: string
          workspace?: string
          tools: ToolDefinition[]
      }

    // 每次请求模型前后
    | {
          type: 'model.start'
          round: number // 从 1 开始，第几次模型调用
          messages: ChatMessage[] // 本次请求的上下文快照
      }
    | {
          type: 'model.end'
          round: number
          finishReason: string
          content: string
          toolCallCount: number
          durationMs: number
      }

    // 每个 tool_call 的完整生命周期
    | {
          type: 'tool.start'
          round: number
          toolCallId: string // 用模型返回的 call id，不用 name 关联
          name: string
          args: unknown
      }
    | {
          type: 'tool.end'
          round: number
          toolCallId: string
          name: string
          status: 'done' | 'failed' | 'cancelled'
          content: string // 原样回给模型的结果，保证和 messages 一致
          error?: string
          durationMs: number
      }

    // 终止：三选一，恰好一次，且是最后一个业务事件
    | {
          type: 'task.completed'
          rounds: number
          reason: CompletedReason
          content: string
          messages: ChatMessage[]
      }
    | {
          type: 'task.failed'
          rounds: number
          error: string
          messages: ChatMessage[]
      }
    | {
          type: 'task.cancelled'
          rounds: number
          reason: string
          cause: CancelCause
          messages: ChatMessage[]
      }

/** 发给 SSE / CLI 的完整事件 */
export type AgentEvent = AgentEventBody & EventMeta
