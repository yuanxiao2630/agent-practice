import { LLM_API_KEY } from '../provider.ts'

/**
 * searchWeb 的后端可选值：
 *   parallel —— Parallel 托管 MCP（默认，免 key）
 *   deepseek —— DeepSeek /v1/tools/search（需要 LLM_API_KEY / DEEPSEEK_API_KEY）
 */
export type SearchBackend = 'parallel' | 'deepseek'

const VALID: readonly SearchBackend[] = ['parallel', 'deepseek']

function isSearchBackend(value: unknown): value is SearchBackend {
  return typeof value === 'string' && (VALID as readonly string[]).includes(value)
}

/**
 * 环境变量优先级最高：部署方显式指定后，运行时接口不允许覆盖，
 * 避免「环境变量说 deepseek、面板却显示 parallel」这种两边不一致。
 * 未设置或值非法（视同未设置）时，用面板/接口设置的模块级状态。
 */
const envBackend = process.env['LLM_SEARCH_PROVIDER']?.toLowerCase()
const envLocked = isSearchBackend(envBackend)
let current: SearchBackend = envLocked ? envBackend : 'parallel'

export function getSearchBackend(): SearchBackend {
  return current
}

/** 环境变量锁定时仍然允许「设置」，但值被忽略——直接返回当前值，不报错，避免前端困惑 */
export function setSearchBackend(value: unknown): SearchBackend {
  if (!isSearchBackend(value)) {
    throw new Error(`search backend 只能是 ${VALID.join(' / ')}，收到: ${String(value)}`)
  }
  if (!envLocked) current = value
  return current
}

/** API 展示用：locked 表示由环境变量锁定，前端据此禁用下拉框 */
export function searchBackendInfo() {
  return {
    backend: getSearchBackend(),
    locked: envLocked,
    deepseekAvailable: Boolean(LLM_API_KEY),
    parallelAvailable: true,
  }
}
