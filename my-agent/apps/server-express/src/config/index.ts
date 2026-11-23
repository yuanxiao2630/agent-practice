import { config as loadEnv } from 'dotenv'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 本文件在 apps/server-express/src/config/，往上两层是 apps/server-express/，所以 ../../.env = apps/server-express/.env。
// 这样不管从哪个目录启动（node apps/server-express/index.ts / npm start:express / 测试），读到的都是同一份配置。
loadEnv({ path: fileURLToPath(new URL('../../.env', import.meta.url)) })

/** 数字型环境变量：空值/非法值都退回默认，避免 NaN 一路传下去 */
function readNumber(name: string, fallback: number): number {
    const raw = process.env[name]
    if (raw === undefined || raw.trim() === '') return fallback
    const value = Number(raw)
    return Number.isFinite(value) ? value : fallback
}

function readString(name: string, fallback: string): string {
    const raw = process.env[name]?.trim()
    return raw || fallback
}

// ---- 服务 ----
export const PORT = readNumber('PORT', 3000)
export const HOST = readString('HOST', '127.0.0.1')
/** 单次请求体上限，超了直接 413，避免把内存吃满 */
export const BODY_LIMIT = readNumber('BODY_LIMIT', 1_000_000)
/** Vite 构建产物目录：apps/web/dist（去掉末尾分隔符，后面拼路径才安全） */
export const WEB_DIST = fileURLToPath(new URL('../../../web/dist/', import.meta.url)).replace(
    /[\\/]+$/,
    '',
)

// ---- 日志 ----
/**
 * 本地事件日志目录：一个 session 一个 <sessionId>.jsonl 文件。
 * 默认落在仓库根目录的 logs/sessions；可以用 LOG_DIR 覆盖。
 */
export const LOG_DIR = resolve(
    readString('LOG_DIR', fileURLToPath(new URL('../../../../logs/sessions/', import.meta.url))),
)

// ---- 模型 ----
export const MODEL = readString('MODEL', 'deepseek-flash')
export const DEEPSEEK_BASE_URL = readString('DEEPSEEK_BASE_URL', 'https://api.deepseek.com')
export const DEEPSEEK_API_KEY = process.env['DEEPSEEK_API_KEY']?.trim() || undefined
/** 一轮对话里最多允许几次「模型决定调工具」的往返 */
export const MAX_ROUNDS = readNumber('MAX_ROUNDS', 10)

// ---- 外部服务 ----
export const AMAP_WEB_KEY = process.env['AMAP_WEB_KEY']?.trim() || undefined
