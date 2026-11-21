import { useCallback, useEffect, useRef, useState } from 'react'
import { createOrJoinRoom, fetchPeers, fetchRooms, sendRoomMessage } from '../api/rooms.ts'
import type { Peer, PeerSelf, RoomEvent, RoomInfo, RoomMessage } from '../types.ts'

const NAME_KEY = 'room-display-name'

function formatTime(at: number): string {
    return new Date(at).toLocaleTimeString('zh-CN', { hour12: false })
}

/** 房间 SSE 事件流：snapshot 进房 / message 新消息 / join|leave 更新参与者名单 */
async function streamRoomEvents(
    roomId: string,
    name: string,
    onEvent: (event: RoomEvent) => void,
    signal: AbortSignal,
): Promise<void> {
    const res = await fetch(
        `/api/rooms/${encodeURIComponent(roomId)}/events?name=${encodeURIComponent(name)}`,
        { signal },
    )
    if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
    }
    if (!res.body) throw new Error('响应没有 body，无法读取流')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''

    while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })

        let idx: number
        while ((idx = buf.indexOf('\n\n')) >= 0) {
            const raw = buf.slice(0, idx).trim()
            buf = buf.slice(idx + 2)
            if (!raw.startsWith('data:')) continue // 心跳注释行 : hb 直接跳过
            const payload = raw.slice(5).trim()
            try {
                onEvent(JSON.parse(payload) as RoomEvent)
            } catch {
                // 忽略坏行，不打断整条流
            }
        }
    }
}

export default function RoomView() {
    const [rooms, setRooms] = useState<RoomInfo[]>([])
    const [current, setCurrent] = useState<RoomInfo | null>(null)
    const [messages, setMessages] = useState<RoomMessage[]>([])
    const [participants, setParticipants] = useState<string[]>([])
    const [connected, setConnected] = useState(false)
    const [error, setError] = useState('')

    const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '')
    const [draft, setDraft] = useState('')
    const [newRoomName, setNewRoomName] = useState('')
    const [creating, setCreating] = useState(false)

    const [peers, setPeers] = useState<Peer[]>([])
    const [self, setSelf] = useState<PeerSelf | null>(null)
    const [peerLoading, setPeerLoading] = useState(false)
    const [manualHost, setManualHost] = useState('')

    const abortRef = useRef<AbortController | null>(null)
    const listRef = useRef<HTMLDivElement>(null)

    // 拉房间列表（组件挂载 + 建房后刷新）
    const refreshRooms = useCallback(() => {
        fetchRooms()
            .then(setRooms)
            .catch(() => setError('房间列表加载失败'))
    }, [])

    useEffect(() => {
        refreshRooms()
    }, [refreshRooms])

    // 名字持久化：改一下就存，刷新页面还在
    useEffect(() => {
        localStorage.setItem(NAME_KEY, name)
    }, [name])

    // 选中房间 → 打开 SSE；切房/卸载时 abort 旧连接
    useEffect(() => {
        if (!current) return
        const ctrl = new AbortController()
        abortRef.current = ctrl
        setConnected(false)
        setMessages([])
        setParticipants(current.participants)

        streamRoomEvents(
            current.id,
            name.trim(),
            (event) => {
                switch (event.type) {
                    case 'snapshot':
                        setMessages(event.messages)
                        setParticipants(event.room.participants)
                        setCurrent((prev) => (prev ? { ...prev, ...event.room } : prev))
                        setConnected(true)
                        break
                    case 'message':
                        setMessages((prev) => {
                            // snapshot 已带尾部消息，去重防止自己刚发的那条出现两次
                            if (prev.some((m) => m.id === event.message.id)) return prev
                            return [...prev, event.message]
                        })
                        break
                    case 'join':
                        setParticipants((prev) =>
                            prev.includes(event.participant.name) ? prev : [...prev, event.participant.name],
                        )
                        break
                    case 'leave':
                        setParticipants((prev) => prev.filter((p) => p !== event.name))
                        break
                }
            },
            ctrl.signal,
        ).catch((err: unknown) => {
            if (ctrl.signal.aborted) return
            setError(err instanceof Error ? err.message : '房间连接失败')
        })

        return () => {
            ctrl.abort()
            abortRef.current = null
        }
        // name 变化会重连 SSE：服务端用 ?name= 做参与者登记，名字变了要重新 touch
    }, [current?.id, name])

    // 新消息滚到底部
    useEffect(() => {
        const el = listRef.current
        if (el) el.scrollTop = el.scrollHeight
    }, [messages])

    const openRoom = useCallback(async (roomName: string) => {
        setError('')
        try {
            const room = await createOrJoinRoom(roomName)
            setCurrent(room)
            refreshRooms()
        } catch (err) {
            setError(err instanceof Error ? err.message : '进入房间失败')
        }
    }, [refreshRooms])

    const createRoom = useCallback(async () => {
        const roomName = newRoomName.trim()
        if (!roomName || creating) return
        setCreating(true)
        try {
            await openRoom(roomName)
            setNewRoomName('')
        } finally {
            setCreating(false)
        }
    }, [newRoomName, creating, openRoom])

    const send = useCallback(async () => {
        const text = draft.trim()
        if (!text || !current) return
        setDraft('')
        try {
            await sendRoomMessage(current.id, text, name.trim() || '匿名')
            // 消息本体由 SSE 推回来；这里不用手动追加，避免和 snapshot 去重逻辑打架
        } catch (err) {
            setError(err instanceof Error ? err.message : '发送失败')
            setDraft(text) // 失败把草稿还回去
        }
    }, [draft, current, name])

    const discover = useCallback(async () => {
        setPeerLoading(true)
        setError('')
        try {
            const { peers: found, self: me } = await fetchPeers()
            setPeers(found)
            setSelf(me ?? null)
        } catch (err) {
            setError(err instanceof Error ? err.message : '发现设备失败')
        } finally {
            setPeerLoading(false)
        }
    }, [])

    const openManual = useCallback(() => {
        const addr = manualHost.trim()
        if (!addr) return
        // 允许输入 host、host:port、http://host:port 三种形式
        const withScheme = /^https?:\/\//.test(addr) ? addr : `http://${addr}`
        window.open(withScheme, '_blank', 'noopener')
    }, [manualHost])

    return (
        <div className="rooms-layout">
            {/* 左侧：房间列表 + 设备发现 */}
            <aside className="rooms-side">
                <div className="rooms-side-head">
                    <span className="rooms-side-title">房间</span>
                    <button type="button" className="link-btn" onClick={discover} disabled={peerLoading}>
                        {peerLoading ? '搜索中…' : '发现局域网设备'}
                    </button>
                </div>

                {/* 设备发现面板 */}
                {(peers.length > 0 || self) && (
                    <div className="peer-panel">
                        {self && (
                            <div className="peer-card self">
                                <div className="peer-name">{self.name}（本机）</div>
                                <div className="peer-addr">{self.host}:{self.port}</div>
                            </div>
                        )}
                        {peers.map((p) => (
                            <button
                                key={`${p.host}:${p.port}`}
                                type="button"
                                className="peer-card"
                                onClick={() => window.open(p.url, '_blank', 'noopener')}
                                title={`打开 ${p.url}`}
                            >
                                <div className="peer-name">{p.name}</div>
                                <div className="peer-addr">{p.host}:{p.port}</div>
                            </button>
                        ))}
                    </div>
                )}

                {/* 手动输入兜底：mDNS 失败时（AP 隔离/VPN）直接填 IP:端口 */}
                <div className="peer-manual">
                    <input
                        value={manualHost}
                        onChange={(e) => setManualHost(e.target.value)}
                        placeholder="手动输入 IP:端口，如 192.168.1.5:5173"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') openManual()
                        }}
                    />
                    <button type="button" onClick={openManual} disabled={!manualHost.trim()}>
                        打开
                    </button>
                </div>

                {/* 新建/加入房间 */}
                <div className="room-create">
                    <input
                        value={newRoomName}
                        onChange={(e) => setNewRoomName(e.target.value)}
                        placeholder="房间名，如「周末聊天」"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') createRoom()
                        }}
                    />
                    <button type="button" className="primary" onClick={createRoom} disabled={!newRoomName.trim() || creating}>
                        进入
                    </button>
                </div>

                {/* 房间列表 */}
                <div className="room-list">
                    {rooms.length === 0 && <div className="room-empty muted">还没有房间，建一个吧</div>}
                    {rooms.map((room) => (
                        <button
                            key={room.id}
                            type="button"
                            className={`room-item ${current?.id === room.id ? 'active' : ''}`}
                            onClick={() => openRoom(room.name)}
                        >
                            <span className="room-item-name">{room.name}</span>
                            <span className="room-item-meta muted">
                                {room.messageCount} 条 · {room.participants.length} 人
                            </span>
                        </button>
                    ))}
                </div>
            </aside>

            {/* 右侧：聊天区 */}
            <section className="rooms-main">
                {!current ? (
                    <div className="rooms-placeholder">
                        <p>选择或创建一个房间，和同 WiFi 下的人（以及本机 Agent）一起聊天。</p>
                        <p className="muted">点左侧「发现局域网设备」可以找到其他正在运行 my-agent 的设备。</p>
                    </div>
                ) : (
                    <>
                        <div className="room-head">
                            <button type="button" className="link-btn" onClick={() => setCurrent(null)}>
                                ← 房间列表
                            </button>
                            <span className="room-title">{current.name}</span>
                            <span className={`room-conn ${connected ? 'on' : ''}`}>
                                {connected ? '已连接' : '连接中…'}
                            </span>
                            <span className="spacer" />
                            <span className="muted room-participants">
                                {participants.length > 0 ? participants.join('、') : '暂无参与者'}
                            </span>
                        </div>

                        <div ref={listRef} className="room-messages">
                            {messages.length === 0 && (
                                <div className="room-empty muted">还没有消息，来说点什么吧</div>
                            )}
                            {messages.map((m) => (
                                <div key={m.id} className={`room-msg ${m.via === 'agent' ? 'agent' : ''}`}>
                                    <div className="room-msg-head">
                                        <span className="room-msg-name">{m.name}</span>
                                        {m.via === 'agent' && <span className="room-msg-tag">agent</span>}
                                        <span className="room-msg-time muted">{formatTime(m.at)}</span>
                                    </div>
                                    <div className="room-msg-text">{m.text}</div>
                                </div>
                            ))}
                        </div>

                        {error && <div className="room-error">{error}</div>}

                        <div className="room-input">
                            <input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="你的名字"
                                className="room-name-input"
                            />
                            <input
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                placeholder="输入消息，Enter 发送"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                                        e.preventDefault()
                                        send()
                                    }
                                }}
                            />
                            <button type="button" className="primary" onClick={send} disabled={!draft.trim()}>
                                发送
                            </button>
                        </div>
                    </>
                )}
            </section>
        </div>
    )
}
