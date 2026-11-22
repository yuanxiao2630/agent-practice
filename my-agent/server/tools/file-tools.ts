import fs from 'fs/promises'
import path from 'path'

/**
 * 文件工具只接受「用户选中的仓库根目录 + 相对路径」。
 * 任何绝对路径、../ 越界、软链接跳到目录外都会在这里被拒绝。
 */
export class WorkspaceAccessError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceAccessError'
  }
}

/** 没选工作区时是 null；文件工具必须把这种情况当成正常业务错误返回给模型 */
type WorkspaceRoot = string | null | undefined

function normalizeRoot(root: WorkspaceRoot): string {
  if (typeof root !== 'string' || !root.trim()) {
    throw new WorkspaceAccessError(
      '还没有选择工作区目录，不能读取本地文件。请先在页面顶部点击「＋ 选择仓库」',
    )
  }
  return path.resolve(root)
}

function isOutside(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  return rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)
}

/** 把相对路径解析到仓库内；不做 IO，纯路径判断 */
export function resolveInsideRoot(root: WorkspaceRoot, input: string): string {
  const rootAbs = normalizeRoot(root)

  if (typeof input !== 'string' || !input.trim()) {
    throw new WorkspaceAccessError('文件路径不能为空')
  }
  if (path.isAbsolute(input)) {
    throw new WorkspaceAccessError(`只能使用相对仓库根的路径，不能传绝对路径：${input}`)
  }

  const resolved = path.resolve(rootAbs, input)
  if (isOutside(rootAbs, resolved)) {
    throw new WorkspaceAccessError(`路径越出了仓库目录：${input}`)
  }
  return resolved
}

/**
 * 软链接也必须落在仓库内：先 realpath 再比较。
 * 文件不存在时保留原始 ENOENT，调用方/测试仍能识别。
 */
async function resolveRealInside(root: WorkspaceRoot, target: string): Promise<string> {
  const rootReal = await fs.realpath(normalizeRoot(root))
  const targetReal = await fs.realpath(target)

  if (isOutside(rootReal, targetReal)) {
    throw new WorkspaceAccessError(`路径通过软链接跳出了仓库目录：${target}`)
  }
  return targetReal
}

/**
 * 1. 读取仓库内的文本文件
 * @param root 用户选中的仓库根目录
 * @param filePath 相对仓库根的路径
 */
export async function readFileContent(root: WorkspaceRoot, filePath: string): Promise<string> {
  const resolved = resolveInsideRoot(root, filePath)
  const real = await resolveRealInside(root, resolved)

  const stat = await fs.stat(real)
  if (!stat.isFile()) throw new WorkspaceAccessError(`不是文件：${filePath}`)

  return fs.readFile(real, 'utf-8')
}

/**
 * 2. 根据函数名，查找函数定义所在行号（1开始）
 * 支持：function fn() {}、const fn = ()=>{}、export async function fn() {}
 * 注意：正则方案有局限，同名函数、嵌套函数、复杂类型会误匹配；精准版需要 tree-sitter
 */
export async function findFunctionLine(
  root: WorkspaceRoot,
  filePath: string,
  funcName: string,
): Promise<number | null> {
  if (typeof funcName !== 'string' || !funcName.trim()) {
    throw new WorkspaceAccessError('函数名不能为空')
  }

  const content = await readFileContent(root, filePath)
  const lines = content.split('\n')

  // 函数名来自模型输入，转义正则元字符，避免被当成表达式
  const safeName = funcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const reg = new RegExp(
    `(export\\s+)?(async\\s+)?function\\s+${safeName}\\s*\\(|const\\s+${safeName}\\s*=\\s*(async\\s+)?\\(`,
    'm',
  )

  for (let i = 0; i < lines.length; i++) {
    if (reg.test(lines[i])) {
      return i + 1 // 行号是 1-based
    }
  }
  return null
}

/**
 * 3. 列出仓库内某个目录的条目（区分文件/文件夹，不递归）
 * @param root 用户选中的仓库根目录
 * @param dirPath 相对仓库根的目录，默认根目录
 */
export async function listWorkspaceEntries(root: WorkspaceRoot, dirPath = '.') {
  const resolved = resolveInsideRoot(root, dirPath)
  const real = await resolveRealInside(root, resolved)

  const stat = await fs.stat(real)
  if (!stat.isDirectory()) throw new WorkspaceAccessError(`不是目录：${dirPath}`)

  const entries = await fs.readdir(real, { withFileTypes: true })
  return entries.map((e) => ({
    name: e.name,
    isDirectory: e.isDirectory(),
    isFile: e.isFile(),
    isSymbolicLink: e.isSymbolicLink(),
  }))
}
