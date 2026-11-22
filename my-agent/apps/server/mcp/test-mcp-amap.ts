import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { AmapMcpClient } from "./mcp-streamable-http.ts";

// 独立脚本：按文件位置加载 apps/server/.env
loadEnv({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

// ========= 配置 =========
// 必须带 import "dotenv/config"，否则 process.env.AMAP_WEB_KEY 永远是 undefined
const AMAP_WEB_KEY = process.env["AMAP_WEB_KEY"]?.trim();

async function main() {
  if (!AMAP_WEB_KEY) {
    console.error("❌ 没有读到 AMAP_WEB_KEY，请在 my-agent/.env 里配置：AMAP_WEB_KEY=你的高德Web服务Key");
    process.exitCode = 1;
    return;
  }

  const amap_mcp = new AmapMcpClient({
    amapWebKey: AMAP_WEB_KEY,
  });

  try {
    await amap_mcp.connect();

    const tools = await amap_mcp.showToolList();
    console.log("可用工具：", tools.map((t) => t.function.name));
  } catch (err) {
    console.error("❌ 异常", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await amap_mcp.close();
  }
}

main().catch(console.error);
