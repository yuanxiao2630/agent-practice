import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

type AmapMcpOptions = {
  amapWebKey: string;
  clientName?: string;
  clientVersion?: string;
};

/** 转换后的 OpenAI function-calling 工具定义 */
export type OpenAIToolDefinition = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
};

const AMAP_MCP_ENDPOINT = "https://mcp.amap.com/mcp";

export class AmapMcpClient {
  private transport?: StreamableHTTPClientTransport;
  private mcpClient?: Client;
  private endpoint?: URL;
  private readonly options: AmapMcpOptions;

  constructor(options: AmapMcpOptions) {
    this.options = {
      clientName: "my-agent",
      clientVersion: "1.0.0",
      ...options,
    };
  }

  async connect() {
    const { amapWebKey, clientName = "agent", clientVersion = "1.0.0" } = this.options;

    // 提前校验，避免把 "undefined" 当成 key 发给高德（那样只会拿到一个看不懂的 ZodError）
    const key = amapWebKey?.trim();
    if (!key || key === "undefined" || key === "null") {
      throw new Error(
        "缺少 AMAP_WEB_KEY：请在项目根目录的 .env 中配置 AMAP_WEB_KEY=你的高德「Web服务」Key，" +
          "并确认脚本里有 import 'dotenv/config'。",
      );
    }

    const MCP_URL = new URL(AMAP_MCP_ENDPOINT);
    MCP_URL.searchParams.set("key", key);
    this.endpoint = MCP_URL;

    // 初始化 transport
    // ⚠️ 高德官方这个接口不需要 Authorization header！不要加 Bearer
    // https://lbs.amap.com/api/mcp-server/gettingstarted
    // 若确实需要自定义头，用 requestInit.headers，transport 本身没有 headers 属性。
    this.transport = new StreamableHTTPClientTransport(MCP_URL);

    // 初始化 MCP Client
    this.mcpClient = new Client({
      name: clientName, // 你的 MCP 客户端名字，告诉 MCP 服务端：是谁在连接我
      version: clientVersion,
    });

    // 连接
    try {
      await this.mcpClient.connect(this.transport);
    } catch (err) {
      throw await this.explainAmapError(err);
    }
    console.log("✅ Amap MCP 连接成功");
  }

  async showToolList(): Promise<OpenAIToolDefinition[]> {
    if (!this.mcpClient) throw new Error("请先调用 connect()");

    // 1. 查看amap暴露出来全部工具（调试用）
    const toolsList = await this.mcpClient.listTools();
    console.log("可用工具：", toolsList.tools.map((t) => t.name), "\n");

    // 简易转换示例（给大模型用）
    const openaiTools: OpenAIToolDefinition[] = toolsList.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema as Record<string, unknown>,
      },
    }));

    return openaiTools;
  }

  /** 通用调用工具 */
  async callTool(name: string, args: Record<string, unknown>) {
    if (!this.mcpClient) throw new Error("请先调用 connect()");
    return await this.mcpClient.callTool({
      name,
      arguments: args,
    });
  }

  /** 关闭连接 */
  async close() {
    if (this.transport) {
      await this.transport.close();
      console.log("✅ MCP 连接已关闭");
    }
    this.mcpClient = undefined;
    this.transport = undefined;
  }

  /**
   * 把高德返回的 REST 错误体翻译成人话。
   * key 无效时高德会返回 HTTP 200 + {"status":"0","info":"INVALID_USER_KEY","infocode":"10001"}，
   * MCP SDK 拿它去校验 JSON-RPC 结构，于是抛出信息量为零的 ZodError
   * （Zod 的报错会丢掉真实内容，只剩 Unrecognized keys: "status", "info", "infocode"）。
   * 所以连接失败时再探一次接口，把真实 body 取回来。
   */
  private async explainAmapError(error: unknown): Promise<Error> {
    const message = error instanceof Error ? error.message : String(error);
    const rest = this.parseAmapRestError(message) ?? (await this.probeAmapRestError());

    if (!rest) {
      return error instanceof Error ? error : new Error(message);
    }

    const detail = [rest.info, rest.infocode ? `infocode=${rest.infocode}` : undefined]
      .filter(Boolean)
      .join(" ");

    return new Error(
      `高德 MCP 拒绝了请求（${detail}）：key 无效、过期，或这个 key 不是「Web服务」类型。` +
        `请检查 .env 里的 AMAP_WEB_KEY（https://console.amap.com/dev/key/app）。\n` +
        `原始错误：${message}`,
    );
  }

  /** 从字符串里提取高德 REST 错误字段（info / infocode） */
  private parseAmapRestError(text: string): { info?: string; infocode?: string } | undefined {
    const info = /"info"\s*:\s*"([^"]+)"/.exec(text)?.[1];
    const infocode = /"infocode"\s*:\s*"?(\d+)"?/.exec(text)?.[1];
    if (!info && !infocode) return undefined;
    return { info, infocode };
  }

  /** 连接失败时用一次原始 fetch 拿到高德真正的响应体 */
  private async probeAmapRestError(): Promise<{ info?: string; infocode?: string } | undefined> {
    if (!this.endpoint) return undefined;

    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "probe",
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "my-agent", version: "1.0.0" },
          },
        }),
      });
      const text = await res.text();
      // 正常的 MCP 响应一定带 jsonrpc 字段；不带的才是高德的错误体
      if (text.includes('"jsonrpc"')) return undefined;
      return this.parseAmapRestError(text) ?? { info: text.trim().slice(0, 200) };
    } catch {
      return undefined;
    }
  }
}
