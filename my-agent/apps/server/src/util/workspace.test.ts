import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test, type TestContext } from 'node:test'
import {
  browseDirectory,
  clearWorkspace,
  getWorkspace,
  setWorkspace,
  WorkspaceError,
} from './workspace.ts'

async function createDir(t: TestContext, prefix = 'workspace-test-'): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  t.after(async () => {
    clearWorkspace()
    await rm(root, { recursive: true, force: true })
  })
  return root
}

test('setWorkspace：保存真实路径和目录名', async (t) => {
  const root = await createDir(t)

  const workspace = await setWorkspace(root)

  assert.equal(workspace.path, await realpath(root))
  assert.equal(workspace.name, path.basename(workspace.path))
  assert.deepEqual(getWorkspace(), workspace)
})

test('setWorkspace：拒绝文件、不存在的路径和空路径', async (t) => {
  const root = await createDir(t)
  const file = path.join(root, 'readme.txt')
  await writeFile(file, 'hi', 'utf-8')

  await assert.rejects(setWorkspace(file), (err) => {
    return err instanceof WorkspaceError && /不是目录/.test(err.message)
  })
  await assert.rejects(setWorkspace(path.join(root, 'missing')), (err) => {
    return err instanceof WorkspaceError && /目录不存在/.test(err.message)
  })
  await assert.rejects(setWorkspace(''), /目录路径不能为空/)
})

test('clearWorkspace：回到未选择状态', async (t) => {
  const root = await createDir(t)
  await setWorkspace(root)

  clearWorkspace()

  assert.equal(getWorkspace(), null)
})

test('browseDirectory：只列目录，并标记 git 仓库和隐藏目录', async (t) => {
  const root = await createDir(t)
  await mkdir(path.join(root, 'src'))
  await mkdir(path.join(root, '.hidden'))
  await mkdir(path.join(root, 'repo', '.git'), { recursive: true })
  await writeFile(path.join(root, 'readme.txt'), 'hi', 'utf-8')

  const result = await browseDirectory(root)
  const names = result.entries.map((entry) => entry.name)

  assert.equal(result.path, await realpath(root))
  assert.equal(result.parent, path.dirname(await realpath(root)))
  assert.equal(names.includes('readme.txt'), false)
  assert.equal(result.entries.find((entry) => entry.name === 'repo')?.isGitRepo, true)
  assert.equal(result.entries.find((entry) => entry.name === '.hidden')?.hidden, true)
  // 默认排序：git 仓库优先，隐藏目录靠后
  assert.equal(names[0], 'repo')
  assert.equal(names.at(-1), '.hidden')
})

test('browseDirectory：不传路径时优先使用当前仓库', async (t) => {
  const root = await createDir(t)
  const repo = path.join(root, 'repo')
  await mkdir(repo)
  await mkdir(path.join(repo, 'src'))

  await setWorkspace(repo)
  const result = await browseDirectory()

  assert.equal(result.path, await realpath(repo))
  assert.deepEqual(result.entries.map((entry) => entry.name), ['src'])
  assert.equal(result.workspace?.path, await realpath(repo))
})

test('browseDirectory：当前仓库被删除时回落到可用目录', async (t) => {
  const root = await createDir(t)
  const repo = path.join(root, 'repo')
  await mkdir(repo)
  await setWorkspace(repo)
  await rm(repo, { recursive: true, force: true })

  const result = await browseDirectory()

  assert.notEqual(result.path, repo)
  assert.ok(Array.isArray(result.entries))
})

test('browseDirectory：路径不可用时抛 WorkspaceError', async (t) => {
  const root = await createDir(t)

  await assert.rejects(browseDirectory(path.join(root, 'missing')), (err) => {
    return err instanceof WorkspaceError && err.status === 400
  })
})
