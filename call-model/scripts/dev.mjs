import { spawn } from 'node:child_process'

// 开发期两条进程：Node 只提供 /api，Vite 提供页面并代理 /api
const bin = process.platform === 'win32' ? 'vite.cmd' : 'vite'

const procs = [
    spawn('node', ['--watch', 'src/server.ts'], { stdio: 'inherit' }),
    spawn(`node_modules/.bin/${bin}`, [], { stdio: 'inherit' }),
]

let stopping = false
const stop = (code = 0) => {
    if (stopping) return
    stopping = true
    for (const p of procs) if (!p.killed) p.kill('SIGINT')
    process.exit(code)
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
for (const p of procs) p.on('exit', (code) => stop(code ?? 0))
