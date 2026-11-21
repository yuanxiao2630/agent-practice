import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    // 前端源码在 web/，Vite 的 root 也指向这里；Node 服务在 server/，两边互不干扰
    root: 'web',
    plugins: [react()],
    server: {
        // 绑 0.0.0.0：房间功能要求同 WiFi 设备能打开 5173 上的页面；
        // 只绑 127.0.0.1 的话 mDNS 广播出去别人也连不上
        host: '0.0.0.0',
        port: 5173,
        proxy: {
            // 开发时页面在 :5173，API 在 :3000；通过代理变同源，SSE 直接透传
            '/api': {
                target: 'http://127.0.0.1:3000',
                changeOrigin: true,
                ws: false,
            },
        },
    },
    build: {
        // 相对 root，实际产物落在 web/dist
        outDir: 'dist',
        emptyOutDir: true,
    },
})
