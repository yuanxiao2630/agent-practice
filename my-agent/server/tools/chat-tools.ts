import { randomUUID } from 'node:crypto'
import {
    getRoomSnapshot,
    joinRoomByName,
    leaveParticipant,
    listRooms,
    postMessage,
    touchParticipant,
    type RoomInfo,
    type RoomMessage,
} from '../rooms/store.ts'

// ---------- chatRoom 工具 ----------
// agent 以「参与者」身份进房间：和浏览器用户一样能发消息、看历史。
// 直接调 store 函数，不走 HTTP——同一进程内调用，少一层序列化和端口依赖。

const AGENT_VIA = 'agent' as const

/** agent 在房间里的显示名：agent-<随机尾号>，进程内固定，重启后换新 */
const agentName = `agent-${randomUUID().slice(0, 8)}`

function formatMessages(messages: RoomMessage[]): string {
    if (messages.length === 0) return '（房间还没有消息）'
    return messages
        .map((m) => {
            const time = new Date(m.at).toLocaleTimeString('zh-CN', { hour12: false })
            return `[${time}] ${m.name}: ${m.text}`
        })
        .join('\n')
}

function roomSummary(room: RoomInfo): string {
    return `房间「${room.name}」（id: ${room.id}），${room.messageCount} 条消息，${room.participants.length} 人在线`
}

export async function chatRoom(args: {
    room?: unknown
    action?: unknown
    text?: unknown
}): Promise<unknown> {
    const roomName = typeof args.room === 'string' ? args.room.trim() : ''
    const action = typeof args.action === 'string' ? args.action.trim() : ''
    const text = typeof args.text === 'string' ? args.text : ''

    if (!roomName) return { error: 'room 参数必填：房间名' }
    if (!['join', 'leave', 'send', 'read'].includes(action)) {
        return { error: "action 只能是 'join' | 'leave' | 'send' | 'read'" }
    }

    // joinRoomByName 是「按名找或建」：agent 说 join 某房间时，如果房间不存在就自动创建，
    // 这样 agent 不需要先知道房间 id，直接说房间名就行
    const room = joinRoomByName(roomName)

    switch (action) {
        case 'join': {
            const touch = touchParticipant(room.id, agentName, AGENT_VIA)
            return {
                ok: true,
                room: roomSummary(room),
                participant: touch?.participant.name,
                hint: '已加入房间；用 send 发言、read 看历史、leave 离开',
            }
        }
        case 'leave': {
            const existed = leaveParticipant(room.id, agentName, AGENT_VIA)
            return existed
                ? { ok: true, room: roomSummary(room), message: '已离开房间' }
                : { ok: false, message: '不在该房间里（可能还没 join 或已被清理）' }
        }
        case 'send': {
            if (!text.trim()) return { error: 'send 需要 text 参数' }
            const result = postMessage(room.id, agentName, text, AGENT_VIA)
            if (!result) return { error: '房间不存在' }
            return {
                ok: true,
                messageId: result.message.id,
                room: roomSummary(result.room),
            }
        }
        case 'read': {
            const snapshot = getRoomSnapshot(room.id)
            if (!snapshot) return { error: '房间不存在' }
            return {
                room: roomSummary(snapshot.room),
                messages: formatMessages(snapshot.messages),
            }
        }
        default:
            return { error: `未知 action: ${action}` }
    }
}

/** 供 agent 系统提示词参考：列出当前有哪些房间可进 */
export function listRoomNames(): string[] {
    return listRooms().map((r) => r.name)
}
