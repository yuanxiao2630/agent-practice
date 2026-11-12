import OpenAI from "openai"
import 'dotenv/config'
import { tools } from './workspaceToolSchemas.ts'

const openai = new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey: process.env['DEEPSEEK_API_KEY'],
})

async function main_completions() {
    const completion = await openai.chat.completions.create({
        messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: "Hello! 列出仓库目录"},
        ],
        tools,
        model: "deepseek-flash",
        thinking: {"type": "enabled"},
        reasoning_effort: "high",
        stream: false,
    });

    console.log(JSON.stringify(completion))
}

async function main_response() {
    const responses = await openai.responses.create({
        model: "deepseek-flash",
        input: 'hello',

    });

    console.log(JSON.stringify(responses))
}

main_completions()

