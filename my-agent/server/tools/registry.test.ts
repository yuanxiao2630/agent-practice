import test from 'node:test'
import assert from 'node:assert/strict'
import {
    enabledToolDefinitions,
    isToolEnabled,
    listTools,
    setToolEnabled,
    setToolsEnabledBySource,
    toolSnapshot,
} from './registry.ts'

test('关闭工具后不再出现在发给模型的列表里', () => {
    const before = enabledToolDefinitions()
    assert.ok(before.length > 0)

    assert.equal(setToolEnabled('readFileContent', false), true)
    assert.equal(isToolEnabled('readFileContent'), false)
    assert.ok(!enabledToolDefinitions().some((t) => t.function.name === 'readFileContent'))

    const item = toolSnapshot().tools.find((t) => t.name === 'readFileContent')
    assert.equal(item?.enabled, false)

    // 恢复现场，避免影响其它用例
    assert.equal(setToolEnabled('readFileContent', true), true)
    assert.equal(isToolEnabled('readFileContent'), true)
})

test('未知工具返回 false，列表不变', () => {
    const before = listTools().length
    assert.equal(setToolEnabled('noSuchTool', false), false)
    assert.equal(listTools().length, before)
})

test('* 可以一次全部关闭 / 全部开启', () => {
    const total = toolSnapshot().total

    assert.equal(setToolEnabled('*', false), true)
    assert.equal(toolSnapshot().enabled, 0)
    assert.equal(enabledToolDefinitions().length, 0)

    assert.equal(setToolEnabled('*', true), true)
    assert.equal(toolSnapshot().enabled, total)
    assert.equal(enabledToolDefinitions().length, total)
})

test('快照与工具列表状态一致', () => {
    const snap = toolSnapshot()
    assert.equal(snap.total, snap.tools.length)
    assert.equal(snap.enabled, snap.tools.filter((t) => t.enabled).length)
    for (const tool of snap.tools) {
        assert.equal(typeof tool.name, 'string')
        assert.ok(tool.source === 'builtin' || tool.source === 'mcp')
    }
})

test('按来源整组开关：内置组可以一次全关 / 全开', () => {
    const before = toolSnapshot()
    const builtinTotal = before.tools.filter((t) => t.source === 'builtin').length
    assert.ok(builtinTotal > 0)

    assert.equal(setToolsEnabledBySource('builtin', false), true)
    const off = toolSnapshot()
    assert.equal(off.tools.filter((t) => t.source === 'builtin' && t.enabled).length, 0)
    // 内置组关完后，测试环境里没有 MCP 工具，模型可用工具应为空
    assert.ok(!enabledToolDefinitions().some((t) => t.function.name === 'readFileContent'))

    assert.equal(setToolsEnabledBySource('builtin', true), true)
    const on = toolSnapshot()
    assert.equal(on.tools.filter((t) => t.source === 'builtin' && t.enabled).length, builtinTotal)
    assert.equal(on.enabled, on.total)
})

test('空分组返回 false（测试环境没有初始化 MCP）', () => {
    assert.equal(setToolsEnabledBySource('mcp', false), false)
})
