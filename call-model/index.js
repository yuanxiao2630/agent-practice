const OpenAI = require('openai')
require('dotenv').config()

const openai = new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey: process.env['DEEPSEEK_API_KEY'],
})

async function main() {
    const completion = await openai.chat.completions.create({
        messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: "Hello!"}
        ],
        model: "deepseek-flash",
        thinking: {"type": "enabled"},
        reasoning_effort: "high",
        stream: false,
    });

    console.log(JSON.stringify(completion))
}

main()