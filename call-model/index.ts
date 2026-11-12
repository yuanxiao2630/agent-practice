import OpenAI from "openai"
import 'dotenv/config'
import { tools } from './workspaceToolSchemas.ts'
import { listWorkspaceEntries, readFileContent, findFunctionLine } from "./workspaceTools.ts";

const openai = new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey: process.env['DEEPSEEK_API_KEY'],
})

async function main_completions() {
    const messages: any[] = [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello! 列出仓库目录，并查找 useFun 这个函数定义的位置" },
    ]

    let count = 1
    
    while (true) {
         const completion = await openai.chat.completions.create({
            messages,
            tools,
            model: "deepseek-flash",
            thinking: {"type": "enabled"},
            reasoning_effort: "high",
            stream: false,
        });

        // message / finish_reason 都在 choices[0] 里，choices 是数组
        const choice = completion.choices[0]
        const message = choice.message
        const finish_reason = choice.finish_reason

        console.log(`Round ${count}`, JSON.stringify(completion));

        if (finish_reason === 'tool_calls') {
            const toolCalls = message.tool_calls ?? []
            if (toolCalls.length === 0) return

            // 1. 先把带 tool_calls 的 assistant 消息放回上下文
            messages.push({ role: "assistant", content: message.content ?? "", tool_calls: message.tool_calls })

            for (const item of toolCalls) {
                if (item.type !== 'function') continue
                // 2. arguments 是 JSON 字符串，必须 parse
                const args = JSON.parse(item.function.arguments || '{}')
                const res = await useFun(item.function.name, args)
                // 3. 每个 tool_call 都要回一条 role: 'tool' 的消息，id 必须对上
                messages.push({ role: "tool", tool_call_id: item.id, content: JSON.stringify(res) })
            }
            count ++
        } else if (finish_reason === 'stop') {
            break
        } else {
            console.log('模型没有调用工具', finish_reason, message.content)
        }
    }
}

async function useFun(fun: string, arg: Record<string, any>) {
    switch (fun) {
        case 'listWorkspaceEntries':
            // schema 里该工具没有参数，模型只会传 {}，这里用当前工作目录兜底
            return listWorkspaceEntries(arg.workspaceRoot ?? process.cwd())
        case 'readFileContent':
            return readFileContent(arg.filePath)
        case 'findFunctionLine':
            return findFunctionLine(arg.filePath, arg.funcName)
        default:
            throw new Error(`未知工具: ${fun}`)
    }
}

async function main_response() {
    const responses = await openai.responses.create({
        model: "deepseek-flash",
        input: 'hello',

    });

    console.log(JSON.stringify(responses))
}

main_completions()

