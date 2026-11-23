import { TaskState } from "./task-state.ts"

/** agent 往外吐的事件，HTTP 层把它转成 SSE，CLI 层转成终端输出 */
// export type TaskEvent =
//     | { type: 'task.start'; taskInfo: TaskState; } // 目标、工作去、模型配置
//     | { type: 'model.start'; taskInfo: TaskState; } // 轮次、请求编号、耗时、结束原因、usage
//     | { type: 'model.end'; taskInfo: TaskState; } // 轮次、请求编号、耗时、结束原因、usage
//     | { type: 'tool.start'; messages: ChatMessage[] }
//     | { type: 'tool.end'; messages: ChatMessage[] }
//     | { type: 'task.completed'; messages: ChatMessage[] }
//     | { type: 'task.failed'; messages: ChatMessage[] }
//     | { type: 'task.cancelled'; messages: ChatMessage[] }
//     | { type: 'task.interrupted'; messages: ChatMessage[] }
//     | { type: 'context.reset'; messages: ChatMessage[] }
//     | { type: 'error'; messages: ChatMessage[] }

    // | { type: 'round'; round: number; messages: ChatMessage[] }
    // | { type: 'tool_start'; round: number; name: string; args: unknown }
    // | { type: 'tool_end'; round: number; name: string; content: string }
    // | { type: 'final'; rounds: number; content: string; messages: ChatMessage[] }
    // | { type: 'aborted'; round: number; reason: string; runId?: string }
    // | { type: 'error'; message: string }
    // | { type: 'tools'; tools: ToolDefinition[] }

// round 表示每次对话下，第几次调用模型
// usage: {
//     inputTokens: 1200,  // 输入：系统提示、历史消息、工具定义等
//     outputTokens: 300,  // 输出：模型生成的内容、工具调用等
//     totalTokens: 1500,  // 总消耗
// }