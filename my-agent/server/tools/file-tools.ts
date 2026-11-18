import fs from "fs/promises";
import path from "path";

/**
 * 1. 读取文件内容
 * @param filePath 文件绝对路径 / 相对仓库根的相对路径
 * @returns 文件文本
 */
export async function readFileContent(filePath: string): Promise<string> {
  const resolved = path.resolve(filePath);
  return fs.readFile(resolved, "utf-8");
}

/**
 * 2. 根据函数名，查找函数定义所在行号（1开始）
 * 支持：function fn() {}、const fn = ()=>{}、export async function fn() {}
 * 注意：正则方案有局限，同名函数、嵌套函数、复杂类型会误匹配；精准版需要 tree-sitter
 * @param filePath 目标文件路径
 * @param funcName 函数名字
 * @returns 找到的行号；找不到返回 null
 */
export async function findFunctionLine(filePath: string, funcName: string): Promise<number | null> {
  const content = await readFileContent(filePath);
  const lines = content.split("\n");

  // 匹配：function / const 箭头函数 / export async function
  const reg = new RegExp(
    `(export\\s+)?(async\\s+)?function\\s+${funcName}\\s*\\(|const\\s+${funcName}\\s*=\\s*(async\\s+)?\\(`,
    "m"
  );

  for (let i = 0; i < lines.length; i++) {
    if (reg.test(lines[i])) {
      return i + 1; // 行号是 1-based
    }
  }
  return null;
}

/**
 * 3. 列出工作区根目录条目（区分文件/文件夹，不递归）
 * @param workspaceRoot 仓库根目录绝对路径
 * @returns 条目数组，包含名字、是否目录
 */
export async function listWorkspaceEntries(workspaceRoot: string) {
  const entries = await fs.readdir(workspaceRoot, { withFileTypes: true });
  return entries.map((e) => ({
    name: e.name,
    isDirectory: e.isDirectory(),
    isFile: e.isFile(),
  }));
}
