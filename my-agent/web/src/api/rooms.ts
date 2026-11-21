import type { Peer, PeersResponse, RoomInfo, RoomMessage, RoomSnapshot } from '../types.ts'

/** SSE 解析与 api/chat.ts 同一套：fetch + ReadableStream，按 \n\n 切事件 */
async function readApi<T>(res: Response): Promise<T> {
    const raw: unknown = await res.json().catch(() => ({}))
    if (!res.ok) {
        const message =
            raw && typeof raw === 'object' && 'error' in raw && typeof raw.error === 'string'
                ? raw.error
                : `HTTP ${res.status}`
        throw new Error(message)
    }
    return raw as T
}
export async function fetchRooms(): Promise<RoomInfo[]> {
    const res = await fetch('/api/rooms')
    const data = await readApi<{ rooms?: RoomInfo[] }>(res)
    return data.rooms ?? []
}

/** 同名房间会直接进同一个（服务端 find-or-create），返回房间信息 */
export async function createOrJoinRoom(name: string): Promise<RoomInfo> {
    const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
    })
    const data = await readApi<{ room: RoomInfo }>(res)
    return data.room
}

export async function fetchRoom(id: string): Promise<RoomSnapshot> {
    const res = await fetch(`/api/rooms/${encodeURIComponent(id)}`)
    return readApi<RoomSnapshot>(res)
}

export async function sendRoomMessage(
    roomId: string,
    text: string,
    name: string,
): Promise<RoomMessage> {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, text }),
    })
    const data = await readApi<{ message: RoomMessage }>(res)
    return data.message
}

export async function fetchPeers(): Promise<{ peers: Peer[]; self?: PeersResponse['self'] }> {
    const res = await fetch('/api/peers')
    const data = await readApi<PeersResponse>(res)
    return { peers: data.peers ?? [], self: data.self }
}
