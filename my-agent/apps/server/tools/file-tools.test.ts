import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import {
  findFunctionLine,
  listWorkspaceEntries,
  readFileContent,
  WorkspaceAccessError,
} from "./file-tools.ts";

// 每个测试使用自己的临时目录，结束后自动清理。
async function createWorkspace(t: TestContext, prefix = "file-manage-test-"): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("readFileContent：只接受相对仓库根的路径", async (t) => {
  // 1. 准备输入：创建一个内容已知的文件。
  const root = await createWorkspace(t);
  const filePath = path.join(root, "hello.txt");
  const expected = "你好，file manager！\n这是第二行。\n";
  await writeFile(filePath, expected, "utf-8");

  // 2. 调用函数：异步函数需要 await。
  const actual = await readFileContent(root, "hello.txt");

  // 3. 断言结果：实际值必须等于预期值，否则测试失败。
  assert.equal(actual, expected);
});

test("readFileContent：嵌套相对路径可以读取", async (t) => {
  const root = await createWorkspace(t);
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "index.ts"), "export const ok = true\n", "utf-8");

  assert.equal(await readFileContent(root, "src/index.ts"), "export const ok = true\n");
});

test("readFileContent：拒绝绝对路径", async (t) => {
  const root = await createWorkspace(t);
  const filePath = path.join(root, "hello.txt");
  await writeFile(filePath, "hi", "utf-8");

  await assert.rejects(readFileContent(root, filePath), WorkspaceAccessError);
  await assert.rejects(readFileContent(root, filePath), /只能使用相对仓库根/);
});

test("readFileContent：拒绝 ../ 越出仓库", async (t) => {
  const root = await createWorkspace(t);
  const outside = await createWorkspace(t, "file-manage-outside-");
  const outsideFile = path.join(outside, "outside.txt");
  await writeFile(outsideFile, "secret", "utf-8");

  await assert.rejects(
    readFileContent(root, path.relative(root, outsideFile)),
    /越出了仓库目录/,
  );
});

test("readFileContent：拒绝软链接跳到仓库外", async (t) => {
  const root = await createWorkspace(t);
  const outside = await createWorkspace(t, "file-manage-outside-");
  const outsideFile = path.join(outside, "secret.txt");
  await writeFile(outsideFile, "secret", "utf-8");

  await symlink(outsideFile, path.join(root, "link.txt"));
  await assert.rejects(readFileContent(root, "link.txt"), /软链接跳出了仓库目录/);
});

test("readFileContent：文件不存在时返回被拒绝的 Promise", async (t) => {
  const root = await createWorkspace(t);

  await assert.rejects(readFileContent(root, "missing.txt"), {
    code: "ENOENT",
  });
});

test("readFileContent：没有工作区根时拒绝读取", async () => {
  await assert.rejects(readFileContent("", "a.txt"), /还没有选择工作区目录/);
  await assert.rejects(readFileContent(null, "a.txt"), /还没有选择工作区目录/);
  await assert.rejects(readFileContent(undefined, "a.txt"), /还没有选择工作区目录/);
  await assert.rejects(listWorkspaceEntries(null), /还没有选择工作区目录/);
  await assert.rejects(findFunctionLine(null, "a.ts", "fn"), /还没有选择工作区目录/);
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

  assert.equal(await findFunctionLine(root, "functions.ts", "plain"), 1);
  assert.equal(await findFunctionLine(root, "functions.ts", "arrow"), 3);
  assert.equal(await findFunctionLine(root, "functions.ts", "exported"), 5);
  assert.equal(await findFunctionLine(root, "functions.ts", "asyncArrow"), 7);
});

test("findFunctionLine：找不到函数时返回 null", async (t) => {
  const root = await createWorkspace(t);
  await writeFile(path.join(root, "functions.ts"), "function existing() {}\n", "utf-8");

  assert.equal(await findFunctionLine(root, "functions.ts", "missing"), null);
});

test("listWorkspaceEntries：区分文件和目录，且不递归列出子目录内容", async (t) => {
  const root = await createWorkspace(t);
  await writeFile(path.join(root, "readme.txt"), "测试文件", "utf-8");
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "nested.ts"), "", "utf-8");

  const entries = await listWorkspaceEntries(root);

  // 目录条目的返回顺序不是测试重点，排序后再比较整个数组。
  assert.deepEqual(
    entries.map(({ name, isDirectory, isFile }) => ({ name, isDirectory, isFile }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [
      { name: "readme.txt", isDirectory: false, isFile: true },
      { name: "src", isDirectory: true, isFile: false },
    ],
  );
});

test("listWorkspaceEntries：可以列子目录，且不能越界", async (t) => {
  const root = await createWorkspace(t);
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "nested.ts"), "", "utf-8");

  const entries = await listWorkspaceEntries(root, "src");
  assert.deepEqual(
    entries.map(({ name, isDirectory, isFile }) => ({ name, isDirectory, isFile })),
    [{ name: "nested.ts", isDirectory: false, isFile: true }],
  );

  await assert.rejects(listWorkspaceEntries(root, ".."), /越出了仓库目录/);
  await assert.rejects(listWorkspaceEntries(root, "/tmp"), /只能使用相对仓库根/);
});

test("listWorkspaceEntries：空目录返回空数组", async (t) => {
  const root = await createWorkspace(t);

  assert.deepEqual(await listWorkspaceEntries(root), []);
});
