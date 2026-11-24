import { DEEPSEEK_API_KEY, HOST, PORT, WEB_DIST } from './src/config/index.ts'
import { createApp } from './src/http/app.ts'
import { flushEventLog } from './src/logging/event-log.ts'
import { closeMcp, initMcp } from './src/mcp/index.ts'
import { abortError } from './src/agent/index.ts'
import { checkpointStore } from './src/persistence/checkpoint.ts'
import { currentRun, restoreSession } from './src/session.ts'

/**
 * 服务入口：检查配置、恢复 checkpoint、初始化 MCP、监听端口。
 * 路由和业务都在 src/http 和 src/session 里，这里保持可读。
 */

if (!DEEPSEEK_API_KEY) {
    console.warn('[config] 没有配置 DEEPSEEK_API_KEY：页面能打开，但发起对话会报错')
}

// MCP 是 fail-soft 的：高德连不上只 warn，不影响服务启动和普通对话
await restoreSession()
await initMcp()

const app = createApp()

app.listen(PORT, HOST, () => {
    console.log(`API 已启动: http://${HOST}:${PORT}`)
    console.log(`静态目录: ${WEB_DIST}`)
    console.log('开发：先 npm run dev，然后访问 http://127.0.0.1:5173')
    console.log('生产：先 npm run build，然后访问上面这个 API 地址')
})

/** 关服务时先断开 MCP 连接，再放进程走 */
let closing = false
async function shutdown(signal: string): Promise<void> {
    if (closing) return
    closing = true
    console.log(`\n[${signal}] 正在关闭…`)

    currentRun()?.controller.abort(abortError('服务关闭', 'server_shutdown'))
    // 等待任务 catch/finally 保存取消现场；不响应取消的工具最多等待 3 秒。
    await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 3_000)
        app.close(() => { clearTimeout(timer); resolve() })
    })
    await flushEventLog().catch(() => {})
    await checkpointStore.flush().catch((error) => console.error('[checkpoint] 关闭时写入失败：', error))
    await closeMcp().catch(() => {})

    process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
