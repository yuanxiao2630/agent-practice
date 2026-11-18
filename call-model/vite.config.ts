import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    // 前端源码在 web/，Vite 的 root 也指向这里；Node 服务在 src/，两边互不干扰
    root: 'web',
    plugins: [react()],
    server: {
        // 默认会只绑 ::1，导致 http://127.0.0.1:5173 打不开；显式绑 IPv4
        host: '127.0.0.1',
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
