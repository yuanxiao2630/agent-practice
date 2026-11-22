import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { createMessages, runAgent, MAX_ROUNDS } from './agent.ts'
import { setWorkspace } from './workspace.ts'

async function main() {
    if (!process.env['DEEPSEEK_API_KEY']) {
        console.error('缺少 DEEPSEEK_API_KEY，请在 my-agent/.env 里配置')
        process.exitCode = 1
        return
    }

    const rl = readline.createInterface({ input, output })

    // 命令行也遵守同一条规则：文件工具只能访问用户明确选择的工作区；
    // 不选也能聊天，只是模型调用文件工具时会拿到「未选择工作区」。
    let target = process.argv[2]?.trim() ?? ''
    if (!target) {
        try {
            target = (
                await rl.question('请输入工作区目录（直接回车跳过，仅普通对话）：')
            ).trim()
        } catch {
            target = ''
        }
    }

    if (target) {
        try {
            const workspace = await setWorkspace(target)
            console.log(`仓库：${workspace.path}`)
        } catch (err) {
            console.error('目录不可用：', err instanceof Error ? err.message : err)
            rl.close()
            process.exitCode = 1
            return
        }
    } else {
        console.log('未选择工作区：仅支持普通对话，文件工具会提示先选择工作区。')
    }

    const messages = createMessages()
    const reset = () => {
        messages.length = 0
        messages.push(...createMessages())
    }

    console.log(`迷你 agent 已启动（最多 ${MAX_ROUNDS} 轮工具调用）`)
    console.log('输入问题后回车发送；/repo <目录> 切换仓库，/reset 清空上下文，/exit 退出\n')

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
            reset()
            console.log('已清空上下文')
            continue
        }
        if (text.startsWith('/repo ')) {
            const repo = text.slice('/repo '.length).trim()
            try {
                const workspace = await setWorkspace(repo)
                reset()
                console.log(`已切换仓库：${workspace.path}（上下文已清空）`)
            } catch (err) {
                console.error('切换失败：', err instanceof Error ? err.message : err)
            }
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
