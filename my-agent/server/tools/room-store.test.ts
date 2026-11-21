import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    createRoom,
    getRoomSnapshot,
    joinRoomByName,
    leaveParticipant,
    listRooms,
    postMessage,
    subscribe,
    touchParticipant,
} from '../rooms/store.ts'

// 房间是进程级全局状态，测试之间用不同房间名隔离，避免互相污染
test('createRoom + joinRoomByName 同名复用', () => {
    const a = createRoom('测试房间A')
    const b = joinRoomByName('测试房间A')
    const c = joinRoomByName('测试房间B')

    assert.equal(a.id, b.id, '同名房间应该返回同一个 id')
    assert.notEqual(a.id, c.id, '不同名应该是不同房间')
    assert.equal(a.name, '测试房间A')
})

test('postMessage 追加消息并触发订阅', () => {
    const room = createRoom('测试房间C')
    const events: string[] = []
    const unsub = subscribe(room.id, (e) => events.push(e.type))
    assert.ok(unsub, '房间存在时 subscribe 应返回取消函数')

    const result = postMessage(room.id, '小明', '你好', 'user')
    assert.ok(result)
    assert.equal(result.message.name, '小明')
    assert.equal(result.message.text, '你好')
    assert.equal(result.message.via, 'user')

    // 首次发言会带 join 参与者
    assert.ok(result.join)
    assert.equal(result.join.name, '小明')

    assert.deepEqual(events, ['message'])
    unsub()
})

test('postMessage 空文本被拒绝', () => {
    const room = createRoom('测试房间D')
    assert.equal(postMessage(room.id, 'x', '   ', 'user'), undefined)
})

test('touchParticipant 幂等：同一 name+via 只算一个人', () => {
    const room = createRoom('测试房间E')
    const t1 = touchParticipant(room.id, 'agent', 'agent')
    const t2 = touchParticipant(room.id, 'agent', 'agent')
    assert.equal(t1?.isNew, true)
    assert.equal(t2?.isNew, false, '第二次 touch 不算新参与者')
    assert.equal(t1?.participant.name, 'agent')
})

test('leaveParticipant 移除参与者', () => {
    const room = createRoom('测试房间F')
    touchParticipant(room.id, 'agent', 'agent')
    assert.equal(leaveParticipant(room.id, 'agent', 'agent'), true)
    assert.equal(leaveParticipant(room.id, 'agent', 'agent'), false, '重复 leave 返回 false')
})

test('getRoomSnapshot 返回房间信息和消息', () => {
    const room = createRoom('测试房间G')
    postMessage(room.id, 'a', '第一条', 'user')
    postMessage(room.id, 'b', '第二条', 'agent')

    const snap = getRoomSnapshot(room.id)
    assert.ok(snap)
    assert.equal(snap.room.name, '测试房间G')
    assert.equal(snap.room.messageCount, 2)
    assert.equal(snap.messages.length, 2)
    assert.equal(snap.messages[0].name, 'a')
    assert.equal(snap.messages[1].via, 'agent')
})

test('listRooms 包含所有房间', () => {
    const before = listRooms().length
    createRoom('测试房间H')
    assert.equal(listRooms().length, before + 1)
})
