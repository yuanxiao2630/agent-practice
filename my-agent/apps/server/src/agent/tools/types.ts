/**
 * 工具这个概念的公共契约。
 *
 * 之前同一个形状被定义了三次：manifest 里用 SDK 的 ChatCompletionTool、
 * registry 里用 FunctionTool、MCP 里用 OpenAIToolDefinition。
 * 现在统一成 ToolDefinition，谁要描述一个工具都用它。
 */

export type ToolSource = 'builtin' | 'mcp'

/** 和 OpenAI function calling 的形状一致，可以直接塞进 tools 参数 */
export type ToolDefinition = {
    type: 'function'
    function: {
        name: string
        description?: string
        parameters?: Record<string, unknown>
    }
}

/** 给前端工具面板用的快照 */
export type ToolInfo = {
    name: string
    description: string
    source: ToolSource
    enabled: boolean
}
