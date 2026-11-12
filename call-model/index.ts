/**
 * 终端模式：运行后在终端输入问题、回车发送。
 *   npm run cli        （或 node index.ts）
 * 命令：/reset 清空上下文，/exit 退出
 * 网页模式见 server.ts（npm run web）
 */
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { createMessages, runAgent, MAX_ROUNDS } from './agent.ts'

async function main() {
    if (!process.env['DEEPSEEK_API_KEY']) {
        console.error('缺少 DEEPSEEK_API_KEY，请在 call-model/.env 里配置')
        process.exitCode = 1
        return
    }

    const messages = createMessages()
    const rl = readline.createInterface({ input, output })

    console.log(`迷你 agent 已启动（最多 ${MAX_ROUNDS} 轮工具调用）`)
    console.log('输入问题后回车发送；/reset 清空上下文，/exit 退出\n')

    while (true) {
        let line: string
        try {
            line = await rl.question('> ')
        } catch {
            break // Ctrl+D / 流被关闭
        }

        const text = line.trim()
        if (!text) continue
        if (text === '/exit' || text === '/quit') break
        if (text === '/reset') {
            messages.length = 0
            messages.push(...createMessages())
            console.log('已清空上下文')
            continue
        }

        messages.push({ role: 'user', content: text })

        try {
            await runAgent(messages, (e) => {
                if (e.type === 'round') console.log(`[第 ${e.round} 轮]`)
                else if (e.type === 'tool_start') console.log(`  🔧 ${e.name} ${JSON.stringify(e.args)}`)
                else if (e.type === 'tool_end') console.log(`  ✓ ${e.name} 返回 ${e.content.length} 字符`)
                else if (e.type === 'final') console.log(`\n${e.content}\n`)
            })
        } catch (err) {
            console.error('出错了：', err instanceof Error ? err.message : err)
        }
    }

    rl.close()
}

main()
