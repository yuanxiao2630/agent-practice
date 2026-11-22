import type { ToolDefinition } from '../agent/tools/types.ts'
import { AMAP_WEB_KEY } from '../config/index.ts'
import { AmapMcpClient } from './amap-client.ts'

/**
 * 通用 MCP 生命周期。
 * 目前只有高德一个 provider，所以这里直接用它；再加第二个时，
 * 把 provider 列表抽出来遍历即可，调用方不用改。
 */

let client: AmapMcpClient | undefined
let tools: ToolDefinition[] = []
let starting: Promise<void> | undefined

/** 幂等：启动时调一次；高德挂了只 warn，不阻断 agent */
export async function initMcp(): Promise<void> {
    if (tools.length) return

    starting ??= (async () => {
        if (!AMAP_WEB_KEY) {
            console.warn('[mcp] 没配置 AMAP_WEB_KEY，跳过地图工具')
            return
        }

        const c = new AmapMcpClient({ amapWebKey: AMAP_WEB_KEY })
        try {
            await c.connect()
            tools = await c.showToolList()
            client = c
        } catch (e) {
            // fail-soft：地图工具不可用不影响文本对话
            console.warn('[mcp] 地图工具不可用：', e instanceof Error ? e.message : e)
        } finally {
            starting = undefined
        }
    })()

    await starting
}

export const mcpTools = (): ToolDefinition[] => tools

export async function callMcpTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
): Promise<unknown> {
    // 通过函数取，别让 TS 把模块级 let 的收窄带进来（重连后就对不上了）
    const first = await ensureClient()
    if (!first) throw new Error(`地图工具不可用：${name}`)

    try {
        return await first.callTool(name, args, signal)
    } catch {
        // session 过期 / 网络抖动：重连一次再试
        await first.close()
        if (client === first) {
            client = undefined
            tools = []
        }

        const second = await ensureClient()
        if (!second) throw new Error(`地图工具不可用：${name}`)
        return await second.callTool(name, args)
    }
}

/** 拿到可用的 client（会触发一次幂等初始化），拿不到就返回 undefined */
async function ensureClient(): Promise<AmapMcpClient | undefined> {
    await initMcp()
    return client
}

export async function closeMcp(): Promise<void> {
    await client?.close()
    client = undefined
    tools = []
}
