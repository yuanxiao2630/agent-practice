import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    // root 由命令行的 `vite apps/web` 指定，产物落在 apps/web/dist
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
        // 相对 root（apps/web），实际产物落在 apps/web/dist
        outDir: 'dist',
        emptyOutDir: true,
    },
})
