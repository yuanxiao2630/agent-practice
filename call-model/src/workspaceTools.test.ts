import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import {
  findFunctionLine,
  listWorkspaceEntries,
  readFileContent,
} from "./workspaceTools.ts";

// 每个测试使用自己的临时目录，结束后自动清理。
async function createWorkspace(t: TestContext): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "file-manage-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("readFileContent：通过绝对路径和相对路径读取 UTF-8 文本", async (t) => {
  // 1. 准备输入：创建一个内容已知的文件。
  const root = await createWorkspace(t);
  const filePath = path.join(root, "hello.txt");
  const expected = "你好，file manager！\n这是第二行。\n";
  await writeFile(filePath, expected, "utf-8");

  // 2. 调用函数：异步函数需要 await。
  const actual = await readFileContent(filePath);

  // 3. 断言结果：实际值必须等于预期值，否则测试失败。
  assert.equal(actual, expected);
  assert.equal(
    await readFileContent(path.relative(process.cwd(), filePath)),
    expected,
  );
});

test("readFileContent：文件不存在时返回被拒绝的 Promise", async (t) => {
  const root = await createWorkspace(t);

  await assert.rejects(readFileContent(path.join(root, "missing.txt")), {
    code: "ENOENT",
  });
});

test("findFunctionLine：支持多种函数写法，行号从 1 开始", async (t) => {
  const root = await createWorkspace(t);
  const filePath = path.join(root, "functions.ts");
  const source = [
    "function plain() {}",                       // 第 1 行
    "",
    "const arrow = () => {};",                   // 第 3 行
    "",
    "export async function exported() {}",        // 第 5 行
    "",
    "const asyncArrow = async () => {};",         // 第 7 行
  ].join("\n");
  await writeFile(filePath, source, "utf-8");

  assert.equal(await findFunctionLine(filePath, "plain"), 1);
  assert.equal(await findFunctionLine(filePath, "arrow"), 3);
  assert.equal(await findFunctionLine(filePath, "exported"), 5);
  assert.equal(await findFunctionLine(filePath, "asyncArrow"), 7);
});

test("findFunctionLine：找不到函数时返回 null", async (t) => {
  const root = await createWorkspace(t);
  const filePath = path.join(root, "functions.ts");
  await writeFile(filePath, "function existing() {}\n", "utf-8");

  assert.equal(await findFunctionLine(filePath, "missing"), null);
});

test("listWorkspaceEntries：区分文件和目录，且不递归列出子目录内容", async (t) => {
  const root = await createWorkspace(t);
  await writeFile(path.join(root, "readme.txt"), "测试文件", "utf-8");
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "nested.ts"), "", "utf-8");

  const entries = await listWorkspaceEntries(root);

  // 目录条目的返回顺序不是测试重点，排序后再比较整个数组。
  assert.deepEqual(
    entries.sort((a, b) => a.name.localeCompare(b.name)),
    [
      { name: "readme.txt", isDirectory: false, isFile: true },
      { name: "src", isDirectory: true, isFile: false },
    ],
  );
});

test("listWorkspaceEntries：空目录返回空数组", async (t) => {
  const root = await createWorkspace(t);

  assert.deepEqual(await listWorkspaceEntries(root), []);
});
