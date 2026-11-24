import { constants, statSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/**
 * 本次会话要处理的仓库目录。
 *
 * 运行期间保存在内存；启动恢复 checkpoint 时重新校验目录后恢复选择。
 * 目录失效则取消选择，不允许文件工具继续使用旧路径。
 */
export type Workspace = {
  /** 真实绝对路径（已解析软链接） */
  path: string
  /** 展示用名字，取目录最后一段 */
  name: string
}

export type WorkspaceShortcut = {
  label: string
  path: string
}

export type BrowseEntry = {
  name: string
  path: string
  hidden: boolean
  /** 目录下是否有 .git（worktree 的 .git 是文件，所以只判断存在） */
  isGitRepo: boolean
}

export type BrowseResult = {
  path: string
  parent: string | null
  entries: BrowseEntry[]
  shortcuts: WorkspaceShortcut[]
  isGitRepo: boolean
  workspace: Workspace | null
}

export class WorkspaceError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'WorkspaceError'
    this.status = status
  }
}

let active: Workspace | null = null

export function getWorkspace(): Workspace | null {
  return active
}

export function clearWorkspace(): void {
  active = null
}

function expandHome(input: string): string {
  if (input === '~') return os.homedir()
  if (input.startsWith('~/') || input.startsWith('~' + path.sep)) {
    return path.join(os.homedir(), input.slice(2))
  }
  return input
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory()
  } catch {
    return false
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target)
    return true
  } catch {
    return false
  }
}

/**
 * 校验用户给的目录：必须存在、是目录、可读，最后返回真实路径。
 * 允许 ~、相对路径（相对服务进程 cwd，主要给命令行用）。
 */
export async function resolveDirectory(input: string): Promise<string> {
  const raw = String(input ?? '').trim()
  if (!raw) throw new WorkspaceError('目录路径不能为空')

  const abs = path.resolve(expandHome(raw))

  let stat
  try {
    stat = await fs.stat(abs)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') throw new WorkspaceError(`目录不存在：${abs}`)
    if (code === 'EACCES' || code === 'EPERM') {
      throw new WorkspaceError(`没有权限访问目录：${abs}`, 403)
    }
    throw new WorkspaceError(`无法访问目录：${abs}`)
  }

  if (!stat.isDirectory()) throw new WorkspaceError(`不是目录：${abs}`)

  const real = await fs.realpath(abs)

  try {
    await fs.access(real, constants.R_OK | constants.X_OK)
  } catch {
    throw new WorkspaceError(`没有读取权限：${real}`, 403)
  }

  return real
}

/** 设置本次会话的仓库；返回真实路径和展示名 */
export async function setWorkspace(input: string): Promise<Workspace> {
  const real = await resolveDirectory(input)
  const workspace: Workspace = {
    path: real,
    name: path.basename(real) || real,
  }
  active = workspace
  return workspace
}

function makeShortcuts(workspace: Workspace | null): WorkspaceShortcut[] {
  const home = os.homedir()
  const candidates: WorkspaceShortcut[] = [
    { label: '桌面', path: path.join(home, 'Desktop') },
    { label: '主目录', path: home },
  ]

  if (workspace) candidates.push({ label: '当前仓库', path: workspace.path })

  const seen = new Set<string>()
  return candidates.filter((item) => {
    if (seen.has(item.path)) return false
    seen.add(item.path)
    return item.path === home || item.path === workspace?.path || isDirectorySync(item.path)
  })
}

// 同步版本只用于几个固定候选目录，避免 browse 因某个快捷目录不可读而失败
function isDirectorySync(target: string): boolean {
  try {
    return statSync(target).isDirectory()
  } catch {
    return false
  }
}

/**
 * 给 UI 的目录浏览器用。
 * input 为空时：优先当前仓库，其次桌面，最后主目录。
 */
export async function browseDirectory(input?: string): Promise<BrowseResult> {
  const home = os.homedir()
  const desktop = path.join(home, 'Desktop')
  const fallback = (await isDirectory(desktop)) ? desktop : home
  const defaultStart =
    active && (await isDirectory(active.path)) ? active.path : fallback
  const start = input?.trim() ? await resolveDirectory(input) : defaultStart

  let dirents
  try {
    dirents = await fs.readdir(start, { withFileTypes: true })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EACCES' || code === 'EPERM') {
      throw new WorkspaceError(`没有权限读取目录：${start}`, 403)
    }
    throw new WorkspaceError(`无法读取目录：${start}`)
  }

  const entries: BrowseEntry[] = []
  for (const dirent of dirents) {
    const full = path.join(start, dirent.name)
    const isDir =
      dirent.isDirectory() || (dirent.isSymbolicLink() && (await isDirectory(full)))
    if (!isDir) continue

    entries.push({
      name: dirent.name,
      path: full,
      hidden: dirent.name.startsWith('.'),
      isGitRepo: await pathExists(path.join(full, '.git')),
    })
  }

  entries.sort((a, b) => {
    // 仓库优先、隐藏目录靠后，其余按名字排
    if (a.isGitRepo !== b.isGitRepo) return a.isGitRepo ? -1 : 1
    if (a.hidden !== b.hidden) return a.hidden ? 1 : -1
    return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
  })

  return {
    path: start,
    parent: start === path.parse(start).root ? null : path.dirname(start),
    entries,
    shortcuts: makeShortcuts(active),
    isGitRepo: await pathExists(path.join(start, '.git')),
    workspace: active,
  }
}
