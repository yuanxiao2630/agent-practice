import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * Parallel 托管 MCP（https://mcp.parallel.ai/mcp）。
 * 不带 key 时 web_search / web_fetch 以 fast 模式免费可用（有速率限制）；
 * 配 PARALLEL_API_KEY 或 PARALLEL_MCP_URL 可换成带认证的端点。
 * 只暴露 web_search，其它工具（fetch/research/decisions）通过 ?tools= 参数裁掉，
 * 避免模型看到一堆用不到的工具。
 */
const PARALLEL_MCP_ENDPOINT =
  process.env['PARALLEL_MCP_URL'] ??
  "https://mcp.parallel.ai/mcp?tools=web_search";

const PARALLEL_API_KEY = process.env['PARALLEL_API_KEY']?.trim();

export class ParallelMcpClient {
  private transport?: StreamableHTTPClientTransport;
  private mcpClient?: Client;

  async connect() {
    const headers: Record<string, string> = {};
    if (PARALLEL_API_KEY) headers["Authorization"] = `Bearer ${PARALLEL_API_KEY}`;

    this.transport = new StreamableHTTPClientTransport(new URL(PARALLEL_MCP_ENDPOINT), {
      requestInit: { headers },
    });
    this.mcpClient = new Client({ name: "my-agent", version: "1.0.0" });
    await this.mcpClient.connect(this.transport);
  }

  async callTool(name: string, args: Record<string, unknown>) {
    if (!this.mcpClient) throw new Error("Parallel MCP 未连接");
    return await this.mcpClient.callTool({ name, arguments: args });
  }

  /** 把 MCP content 块拍平成纯文本/JSON，方便 searchWeb 归一化 */
  static extractContent(result: unknown): string {
    if (!result || typeof result !== 'object' || !('content' in result)) {
      return JSON.stringify(result) ?? 'null';
    }
    const content = result.content;
    if (!Array.isArray(content)) return JSON.stringify(result) ?? 'null';
    return content
      .map((block) => {
        const b = block as { type?: string; text?: string };
        return b.type === 'text' ? (b.text ?? '') : JSON.stringify(block);
      })
      .join('\n');
  }

  async close() {
    await this.transport?.close();
    this.transport = undefined;
    this.mcpClient = undefined;
  }
}
