import { AMAP_WEB_KEY } from "../src/config/index.ts";
import { AmapMcpClient } from "../src/mcp/amap-client.ts";

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
