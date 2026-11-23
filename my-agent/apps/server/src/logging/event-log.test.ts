import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { AgentEvent } from '../agent/types.ts'
import { createEventLog } from './event-log.ts'

function taskStart(sessionId: string, taskId: string, seq = 1): AgentEvent {
    return {
        sessionId,
        taskId,
        seq,
        at: '2026-01-01T00:00:00.000Z',
        type: 'task.start',
        goal: '测试任务',
        tools: [],
    }
}

test('event-log：同一个 session 的多个 task 写进一个 jsonl，按顺序追加', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-event-log-'))

    try {
        const log = createEventLog(dir)
        log.append(taskStart('session-a', 'task-1'))
        log.append(taskStart('session-a', 'task-2', 2))
        await log.flush()

        const files = await readdir(dir)
        assert.deepEqual(files, ['session-a.jsonl'])

        const content = await readFile(join(dir, 'session-a.jsonl'), 'utf8')
        const lines = content
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line) as AgentEvent)

        assert.equal(lines.length, 2)
        assert.equal(lines[0]?.sessionId, 'session-a')
        assert.equal(lines[0]?.taskId, 'task-1')
        assert.equal(lines[1]?.taskId, 'task-2')
        assert.deepEqual(
            lines.map((line) => line.seq),
            [1, 2],
        )
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
})

test('event-log：不同 session 写不同文件', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-event-log-'))

    try {
        const log = createEventLog(dir)
        log.append(taskStart('session-a', 'task-1'))
        log.append(taskStart('session-b', 'task-2'))
        await log.flush()

        const files = (await readdir(dir)).sort()
        assert.deepEqual(files, ['session-a.jsonl', 'session-b.jsonl'])
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
})
