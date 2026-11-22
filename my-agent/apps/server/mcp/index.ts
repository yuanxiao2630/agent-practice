// server/mcp/index.ts
import { AmapMcpClient, type OpenAIToolDefinition } from './mcp-streamable-http.ts'

let client: AmapMcpClient | undefined
let tools: OpenAIToolDefinition[] = []
let starting: Promise<void> | undefined

/** 幂等：启动时调一次；高德挂了只 warn，不阻断 agent */
export async function initMcp() {
  if (tools.length) return
  starting ??= (async () => {
    const key = process.env['AMAP_WEB_KEY']?.trim()
    if (!key) return console.warn('[mcp] 没配置 AMAP_WEB_KEY，跳过地图工具')
    const c = new AmapMcpClient({ amapWebKey: key })
    try {
      await c.connect()
      tools = await c.showToolList()
      client = c
    } catch (e) {
      console.warn('[mcp] 地图工具不可用：', e instanceof Error ? e.message : e)  // fail-soft
    } finally { starting = undefined }
  })()
  await starting
}

export const mcpTools = () => tools

export async function callMcpTool(name: string, args: Record<string, unknown>, signal?: AbortSignal) {
  await initMcp()
  if (!client) throw new Error(`地图工具不可用：${name}`)
  try {
    return await client.callTool(name, args, signal)
  } catch {
    // session 过期/网络抖：重连一次再试
    await client.close(); client = undefined; tools = []
    await initMcp()
    return await client!.callTool(name, args)
  }
}

export async function closeMcp() {
  await client?.close()
  client = undefined; tools = []
}