import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// 独立脚本：按文件位置加载 apps/server/.env
loadEnv({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const AMAP_WEB_KEY = process.env['AMAP_WEB_KEY'] as string;

if (!AMAP_WEB_KEY) {
  throw new Error("缺少 AMAP_WEB_KEY：请在 my-agent/.env 中配置 AMAP_WEB_KEY=你的高德Web服务Key");
}

const transport = new StdioClientTransport({
  command: "npx",
  args: ["-y", "@amap/amap-maps-mcp-server"],
  env: {
    AMAP_MAPS_API_KEY: AMAP_WEB_KEY
  }
});

const mcpClient = new Client({ name: "my-agent", version: "1.0.0" });

await mcpClient.connect(transport);

// 1. 调用 maps_geo：地址转经纬度
const res = await mcpClient.callTool({
  name: "maps_geo",
  arguments: { address: "上海市浦东新区" }
});
console.log(res.content);