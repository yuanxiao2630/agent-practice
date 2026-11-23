import { DEEPSEEK_API_KEY, HOST, PORT, WEB_DIST } from './src/config/index.ts'
import { createApp } from './src/http/app.ts'
import { closeMcp, initMcp } from './src/mcp/index.ts'

/**
 * Express 版服务入口：检查配置、初始化 MCP、监听端口。
 * 与 apps/server/index.ts 的区别只有「createApp() 返回的是 Express app」，
 * 业务层（agent / session / workspace / mcp）完全一致。
 */

if (!DEEPSEEK_API_KEY) {
    console.warn('[config] 没有配置 DEEPSEEK_API_KEY：页面能打开，但发起对话会报错')
}

// MCP 是 fail-soft 的：高德连不上只 warn，不影响服务启动和普通对话
await initMcp()

const app = createApp()

const server = app.listen(PORT, HOST, () => {
    console.log(`Express API 已启动: http://${HOST}:${PORT}`)
    console.log(`静态目录: ${WEB_DIST}`)
    console.log('开发：先 npm run dev，然后访问 http://127.0.0.1:5173')
    console.log('生产：先 npm run build，然后访问上面这个 API 地址')
    console.log('注意：与原 server 默认共用 3000 端口，不要同时启动')
})

server.on('error', (err) => {
    console.error('[server] 监听失败:', err.message)
    process.exitCode = 1
})

/** 关服务时先停 HTTP，再断开 MCP 连接，最后放进程走 */
let closing = false
async function shutdown(signal: string): Promise<void> {
    if (closing) return
    closing = true
    console.log(`\n[${signal}] 正在关闭…`)

    // 还有 SSE 长连接时 close 要等到连接断开；给个 3 秒兜底，别让 Ctrl+C 卡住
    await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
            console.warn('[server] 仍有连接未断开，强制退出')
            resolve()
        }, 3_000)
        timer.unref()
        server.close(() => {
            clearTimeout(timer)
            resolve()
        })
    })

    await closeMcp().catch(() => {})
    process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
