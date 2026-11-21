import 'dotenv/config'
import OpenAI from 'openai'

// 模型供应商配置：默认 DeepSeek，也可以用环境变量指向任何 OpenAI 兼容接口
//   LLM_BASE_URL   例如 https://api.openai.com/v1 或 http://localhost:11434/v1
//   LLM_API_KEY    对应供应商的 key；不设时回退 DEEPSEEK_API_KEY
//   LLM_MODEL      模型名；不设时回退 DEEPSEEK_MODEL，再回退默认值
//   LLM_PROVIDER   供应商标识，目前只有 'deepseek' 会启用 thinking 参数和联网搜索工具
export const LLM_PROVIDER = (process.env['LLM_PROVIDER'] ?? 'deepseek').toLowerCase()

export const LLM_BASE_URL =
    process.env['LLM_BASE_URL'] ?? 'https://api.deepseek.com'

export const LLM_API_KEY =
    process.env['LLM_API_KEY'] ?? process.env['DEEPSEEK_API_KEY']

const DEFAULT_MODEL: Record<string, string> = {
    deepseek: 'deepseek-flash',
    openai: 'gpt-4o-mini',
}

export const LLM_MODEL =
    process.env['LLM_MODEL'] ??
    process.env['DEEPSEEK_MODEL'] ??
    DEFAULT_MODEL[LLM_PROVIDER] ??
    LLM_PROVIDER

/** DeepSeek 兼容接口支持 thinking / reasoning_effort 扩展字段，其它供应商不传，避免 400 */
export const LLM_SUPPORTS_THINKING = LLM_PROVIDER === 'deepseek'



export const openai = new OpenAI({
    baseURL: LLM_BASE_URL,
    apiKey: LLM_API_KEY,
})

/** DeepSeek 的 thinking / reasoning_effort 是 OpenAI 兼容接口的扩展字段，
 *  openai SDK 的类型里没有，统一在这里包一层，调用点不用各自强转 */
type ChatParams = OpenAI.ChatCompletionCreateParamsNonStreaming & {
    thinking?: { type: 'enabled' | 'disabled' }
    reasoning_effort?: 'low' | 'medium' | 'high'
}

export function chat(params: ChatParams) {
    return openai.chat.completions.create(params)
}