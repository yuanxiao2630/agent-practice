import type { Workspace } from '../util/workspace.ts'

/** 系统提示词：随「有没有选仓库」变化，属于内容而不是配置 */
export function buildSystemPrompt(workspace: Workspace | null): string {
    const scope = workspace
        ? `用户本次选择的仓库根目录是：${JSON.stringify(workspace.path)}（名称：${JSON.stringify(workspace.name)}）。
所有文件工具都只能访问这个目录；路径一律传相对仓库根的路径，不要传绝对路径，也不要尝试用 ../ 跳出目录。`
        : `当前没有选择工作区目录：你可以正常聊天，但不能读取任何本地文件。
如果用户要求查看/读取本地文件，请照常调用文件工具；工具会返回「还没有选择工作区目录」的错误，把这个错误转告用户，并提醒他点击顶部的「＋ 选择仓库」。`

    return `你是一个简洁、可靠的编程助手。
${scope}
先用 listWorkspaceEntries 看目录，再读文件；不要臆测文件内容，读到什么说什么。
回答用中文，先给结论再给依据，涉及文件时给出路径和行号。`
}

/** 轮次用尽后的收尾指令：不允许再调工具，只做总结 */
export function buildFinalAnswerPrompt(maxRounds: number): string {
    return `已达到最大工具调用轮次（${maxRounds} 轮），你不能再调用任何工具。
请直接基于上面已经拿到的工具结果，给用户一个完整、可读的最终回答：
1. 先给结论，再补依据；涉及文件时给出路径和行号；
2. 只使用你确实读到的内容，不要臆测；
3. 如果某个问题因轮次用尽没能查证，明确写出「未能确认」。`
}
