import { randomUUID } from 'node:crypto'

// ---------- 房间数据模型 ----------
// 房间只活在本进程内存里：单机单用户练习场景，与 server.ts 的全局 messages 一致，
// 不做持久化。重启后房间和消息全部消失，重新创建即可。

/** 单条聊天消息：name 是显示名（匿名用户 / agent-*），via 标记来源通道 */
export type RoomMessage = {
    id: string
    name: string
    text: string
    via: 'user' | 'agent'
    at: number
}

/** 参与者：浏览器里填名字的人，或本机 agent（name 形如 agent-*） */
export type RoomParticipant = {
    name: string
    via: 'user' | 'agent'
    joinedAt: number
    /** 心跳式续期：发消息或订阅事件流时刷新，长时间没动静的参与者会被清掉 */
    lastSeen: number
}

export type Room = {
    id: string
    name: string
    createdAt: number
    participants: Map<string, RoomParticipant>
    messages: RoomMessage[]
}

/** SSE 广播给每个订阅者的事件；snapshot 是进房瞬间的历史快照 */
export type RoomEvent =
    | { type: 'snapshot'; room: RoomInfo; messages: RoomMessage[] }
    | { type: 'message'; message: RoomMessage }
    | { type: 'join'; participant: RoomParticipant }
    | { type: 'leave'; name: string }

export type RoomInfo = {
    id: string
    name: string
    createdAt: number
    messageCount: number
    participants: string[]
}

export type TouchResult = {
    participant: RoomParticipant
    /** true 表示这次是首次出现在房间里，调用方应广播 join 事件 */
    isNew: boolean
}

const MAX_MESSAGES = 200 // 每个房间保留的最近消息数，防止长聊把内存吃满
const PARTICIPANT_TTL_MS = 10 * 60 * 1000 // 参与者 10 分钟无活动视为离开（浏览器关页没有 leave 事件）

const rooms = new Map<string, Room>()

function roomInfo(room: Room): RoomInfo {
    return {
        id: room.id,
        name: room.name,
        createdAt: room.createdAt,
        messageCount: room.messages.length,
        participants: [...room.participants.values()].map((p) => p.name),
    }
}

function getRoom(id: string): Room | undefined {
    return rooms.get(id)
}

/** 房间名唯一（忽略大小写和首尾空格）：同名直接进同一个房间，符合「命名房间」的直觉 */
function findRoomByName(name: string): Room | undefined {
    const key = name.trim().toLowerCase()
    for (const room of rooms.values()) {
        if (room.name.trim().toLowerCase() === key) return room
    }
    return undefined
}

export function createRoom(name: string): RoomInfo {
    const room: Room = {
        id: randomUUID(),
        name: name.trim().slice(0, 40) || '未命名房间',
        createdAt: Date.now(),
        participants: new Map(),
        messages: [],
    }
    rooms.set(room.id, room)
    return roomInfo(room)
}

/** 创建或加入：同名房间直接复用，返回房间信息 */
export function joinRoomByName(name: string): RoomInfo {
    const existing = findRoomByName(name)
    if (existing) return roomInfo(existing)
    return createRoom(name)
}

export function listRooms(): RoomInfo[] {
    return [...rooms.values()].map(roomInfo)
}

/** 房间详情 + 最近消息（最多回 50 条，前端进房只需要看到尾部） */
export function getRoomSnapshot(id: string): { room: RoomInfo; messages: RoomMessage[] } | undefined {
    const room = getRoom(id)
    if (!room) return undefined
    return { room: roomInfo(room), messages: room.messages.slice(-50) }
}

// ---------- 参与者 ----------

function sweepStale(room: Room) {
    const now = Date.now()
    for (const [key, p] of room.participants) {
        if (now - p.lastSeen > PARTICIPANT_TTL_MS) room.participants.delete(key)
    }
}

/**
 * 加入/刷新参与者。浏览器没有显式 join 接口，每次发消息或订阅事件流都会 touch，
 * 所以「在房间里的人」= 最近 10 分钟内有过动作的人。
 */
export function touchParticipant(roomId: string, name: string, via: 'user' | 'agent'): TouchResult | undefined {
    const room = getRoom(roomId)
    if (!room) return undefined
    sweepStale(room)
    const key = `${via}:${name}`
    const now = Date.now()
    const existing = room.participants.get(key)
    if (existing) {
        existing.lastSeen = now
        return { participant: existing, isNew: false }
    }
    const participant: RoomParticipant = { name, via, joinedAt: now, lastSeen: now }
    room.participants.set(key, participant)
    return { participant, isNew: true }
}

export function leaveParticipant(roomId: string, name: string, via: 'user' | 'agent'): boolean {
    const room = getRoom(roomId)
    if (!room) return false
    return room.participants.delete(`${via}:${name}`)
}

// ---------- 消息 ----------

/** 追加消息并广播；name 为空时落到「匿名」，via 由调用方按来源给出 */
export function postMessage(
    roomId: string,
    name: string | undefined,
    text: string,
    via: 'user' | 'agent',
): { message: RoomMessage; room: RoomInfo; join?: RoomParticipant } | undefined {
    const room = getRoom(roomId)
    if (!room) return undefined
    const trimmed = text.trim()
    if (!trimmed) return undefined

    const who = name?.trim() || '匿名'
    // 发言本身就是活跃信号：顺手把参与者续期/登记上；首次出现时带出 join 事件给调用方广播
    const touch = touchParticipant(roomId, who, via)!

    const message: RoomMessage = {
        id: randomUUID(),
        name: who,
        text: trimmed.slice(0, 4000),
        via,
        at: Date.now(),
    }
    room.messages.push(message)
    if (room.messages.length > MAX_MESSAGES) {
        room.messages.splice(0, room.messages.length - MAX_MESSAGES)
    }
    broadcast(roomId, { type: 'message', message })
    return { message, room: roomInfo(room), join: touch.isNew ? touch.participant : undefined }
}

// ---------- SSE 订阅 ----------

type Listener = (event: RoomEvent) => void
const listeners = new Map<string, Set<Listener>>()

function broadcast(roomId: string, event: RoomEvent) {
    const set = listeners.get(roomId)
    if (!set) return
    for (const fn of set) {
        try {
            fn(event)
        } catch {
            // 单个订阅者写失败（比如客户端断开）不影响其它人
        }
    }
}

/**
 * 订阅房间事件流（message / join / leave 都走这里）。
 * 房间不存在返回 undefined；否则返回取消订阅函数。
 */
export function subscribe(roomId: string, fn: Listener): (() => void) | undefined {
    if (!getRoom(roomId)) return undefined
    let set = listeners.get(roomId)
    if (!set) {
        set = new Set()
        listeners.set(roomId, set)
    }
    set.add(fn)
    return () => {
        set.delete(fn)
        if (set.size === 0) listeners.delete(roomId)
    }
}

/** 供 server.ts 在参与者变化时调用（join / leave 广播） */
export function emitRoomEvent(roomId: string, event: RoomEvent) {
    broadcast(roomId, event)
}
