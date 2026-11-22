import { tools as builtinTools } from './index.ts'
import { mcpTools } from '../mcp/index.ts'

export type ToolSource = 'builtin' | 'mcp'

export type ToolInfo = {
    name: string
    description: string
    source: ToolSource
    enabled: boolean
}

/** 内置工具与 MCP 工具最终都是这个结构 */
export type FunctionTool = {
    type: 'function'
    function: {
        name: string
        description?: string
        parameters?: Record<string, unknown>
    }
}

function isFunctionTool(value: unknown): value is FunctionTool {
    const fn = (value as { function?: { name?: unknown } } | null)?.function
    return typeof fn?.name === 'string'
}

/** 被用户关闭的工具名：进程内状态，重启服务后回到「全部启用」 */
const disabled = new Set<string>()

function builtinFunctionTools(): FunctionTool[] {
    return builtinTools.filter(isFunctionTool)
}

function mcpFunctionTools(): FunctionTool[] {
    return mcpTools().filter(isFunctionTool)
}

export function isToolEnabled(name: string): boolean {
    return !disabled.has(name)
}

/** 面板展示用：不管开关，列出当前所有工具（MCP 未连接时只有内置工具） */
export function listTools(): ToolInfo[] {
    const toInfo = (tool: FunctionTool, source: ToolSource): ToolInfo => ({
        name: tool.function.name,
        description: tool.function.description ?? '',
        source,
        enabled: isToolEnabled(tool.function.name),
    })

    return [
        ...builtinFunctionTools().map((t) => toInfo(t, 'builtin')),
        ...mcpFunctionTools().map((t) => toInfo(t, 'mcp')),
    ]
}

/** 真正发给模型的工具定义：被关闭的工具直接不传，模型就不会调用它 */
export function enabledToolDefinitions(): FunctionTool[] {
    return [...builtinFunctionTools(), ...mcpFunctionTools()].filter((t) =>
        isToolEnabled(t.function.name),
    )
}

/** 设置单个工具；name 传 '*' 表示全部。工具不存在时返回 false */
export function setToolEnabled(name: string, enabled: boolean): boolean {
    const all = [...builtinFunctionTools(), ...mcpFunctionTools()]

    if (name === '*') {
        if (enabled) disabled.clear()
        else for (const tool of all) disabled.add(tool.function.name)
        return true
    }

    if (!all.some((t) => t.function.name === name)) return false
    if (enabled) disabled.delete(name)
    else disabled.add(name)
    return true
}

/** 按来源整组开关，比如 MCP 总开关。该分组没有工具时返回 false */
export function setToolsEnabledBySource(source: ToolSource, enabled: boolean): boolean {
    const all = source === 'builtin' ? builtinFunctionTools() : mcpFunctionTools()
    if (all.length === 0) return false

    for (const tool of all) {
        if (enabled) disabled.delete(tool.function.name)
        else disabled.add(tool.function.name)
    }
    return true
}

/** 一次返回列表 + 汇总，前端不用重复算 */
export function toolSnapshot() {
    const tools = listTools()
    return {
        tools,
        enabled: tools.filter((t) => t.enabled).length,
        total: tools.length,
    }
}
