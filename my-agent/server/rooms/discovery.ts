import dgram from 'node:dgram'
import os from 'node:os'
import { getResponder } from '@homebridge/ciao'
import type { CiaoService } from '@homebridge/ciao'

// ---------- 局域网设备发现 ----------
// 设计取舍：
//   - 广播用 @homebridge/ciao：纯 JS/TS 实现的 DNS-SD 广播器，无 node-gyp 原生编译，
//     在 darwin arm64 + Node 22 上开箱即用；bonjour-service 要编译原生模块，装起来不稳。
//   - 浏览用手写的最小 mDNS 查询器：ciao 只负责 advertise 没有 browse；
//     我们只需要解析 PTR/SRV/A/TXT 四种记录，自己发包比再引一个依赖更可控。
//   - 广播两个服务类型：_myagent._tcp（Web UI，5173/3000 端口）和
//     _myagent-api._tcp（API 端口）。浏览端把同一主机的多个端口合并成一个 peer，
//     UI 优先展示能打开页面的端口。
//   - mDNS 在 AP 隔离 / 部分 VPN 下会失效，所以 UI 同时提供「手动输入 host:port」兜底。

const MDNS_ADDR = '224.0.0.251'
const MDNS_PORT = 5353
const OUR_TYPES = ['_myagent._tcp', '_myagent-api._tcp'] as const
const PEER_TTL_MS = 30_000 // 30 秒没再收到应答就把 peer 滤掉

export type Peer = {
    /** 设备显示名（mDNS 实例名或 TXT name 字段） */
    name: string
    /** 局域网 IP */
    host: string
    /** 该服务监听的端口 */
    port: number
    /** 可直接在浏览器打开的地址 */
    url: string
    /** 最近一次收到该 peer 应答的时间戳 */
    lastSeen: number
}

// ---------- 广播（advertise） ----------

let responder: ReturnType<typeof getResponder> | null = null
const advertised: CiaoService[] = []

/**
 * 开始广播本机服务。ports 里每个端口对应一个 mDNS 服务：
 * 第一个当作「Web UI 入口」（_myagent._tcp），其余当作「API 入口」（_myagent-api._tcp）。
 * 调用方负责在服务真正 listen 之后再调（端口已知才有意义）。
 */
export function startAdvertising(name: string, ports: number[]): void {
    if (advertised.length > 0) return // 幂等：重复调用直接忽略
    try {
        responder = getResponder()
        const [first, ...rest] = ports
        const make = (port: number, api: boolean) => {
            const svc = responder!.createService({
                name,
                // type 不带前导下划线：ciao 会自动补成 _myagent._tcp.local；
                // 直接写 '_myagent' 会变成 __myagent._tcp.local（双下划线），浏览端匹配不上
                type: api ? 'myagent-api' : 'myagent',
                port,
                txt: { name },
            })
            // advertise 是异步的（要先 probe 名字冲突），失败只记日志不影响主流程
            svc.advertise().catch((err: unknown) => {
                console.warn(`[discovery] 广播 ${api ? 'API' : 'UI'} 服务失败:`, err instanceof Error ? err.message : err)
            })
            advertised.push(svc)
        }
        if (first !== undefined) make(first, false)
        for (const port of rest) make(port, true)
    } catch (err) {
        console.warn('[discovery] 初始化 mDNS 广播失败:', err instanceof Error ? err.message : err)
    }
}

export async function stopAdvertising(): Promise<void> {
    for (const svc of advertised.splice(0)) {
        try {
            await svc.end()
        } catch {
            // 关闭阶段失败无所谓，进程马上就退了
        }
    }
    try {
        await responder?.shutdown()
    } catch {
        // 同上
    }
    responder = null
}

// ---------- 浏览（browse）：手写 mDNS 查询 ----------
// 只实现我们需要的子集：发 PTR 查询 → 收 PTR/SRV/A/AAAA/TXT 应答 → 拼成 Peer 列表。
// 不支持泛洪查询、连续查询、DNSSEC 等，局域网小报文场景足够。

type DnsRecord = {
    name: string
    type: number
    /** A: ipv4 字符串；AAAA: ipv6；PTR/SRV/CNAME: 域名；TXT: 原始 buffer */
    data: string | Buffer
}

/** 解析 DNS 压缩域名；返回 [名字, 消耗字节数]。offset 指向包内某位置。 */
function parseName(buf: Buffer, offset: number): [string, number] {
    const labels: string[] = []
    let pos = offset
    let jumped = false
    let endPos = pos
    let guard = 0
    while (guard++ < 128) {
        const len = buf[pos]
        if (len === undefined) throw new Error('域名越界')
        if (len === 0) {
            if (!jumped) endPos = pos + 1
            break
        }
        const top = len & 0xc0
        if (top === 0xc0) {
            // 压缩指针：后两字节是绝对偏移
            if (pos + 1 >= buf.length) throw new Error('压缩指针越界')
            const ptr = ((len & 0x3f) << 8) | buf[pos + 1]
            if (!jumped) {
                endPos = pos + 2
                jumped = true
            }
            pos = ptr
            continue
        }
        if (top !== 0) throw new Error('不支持的域名标签')
        pos += 1
        if (pos + len > buf.length) throw new Error('标签越界')
        labels.push(buf.subarray(pos, pos + len).toString('utf8'))
        pos += len
    }
    return [labels.join('.'), endPos]
}

const TYPE_A = 1
const TYPE_CNAME = 5
const TYPE_PTR = 12
const TYPE_TXT = 16
const TYPE_AAAA = 28
const TYPE_SRV = 33

/** 解析 DNS 响应包里的应答记录（跳过 question 段）。坏包直接返回空数组。 */
function parseAnswers(buf: Buffer): DnsRecord[] {
    if (buf.length < 12) return []
    const qd = buf.readUInt16BE(4)
    const an = buf.readUInt16BE(6)
    if ((buf[2] & 0x80) === 0) return [] // 只处理响应包（QR=1）

    let pos = 12
    // 跳过 question 段
    for (let i = 0; i < qd; i++) {
        try {
            const [, next] = parseName(buf, pos)
            pos = next + 4 // QTYPE + QCLASS
        } catch {
            return []
        }
    }

    const records: DnsRecord[] = []
    for (let i = 0; i < an; i++) {
        try {
            const [rawName, nameEnd] = parseName(buf, pos)
            // mDNS 应答里的域名都带尾部的点（如 "host.local."），统一去掉再比对
            const name = rawName.replace(/\.$/, '')
            pos = nameEnd
            const type = buf.readUInt16BE(pos)
            // CLASS(2) + TTL(4) + RDLENGTH(2)
            const rdlen = buf.readUInt16BE(pos + 8)
            const rdataStart = pos + 10
            const rdataEnd = rdataStart + rdlen
            if (rdataEnd > buf.length) break
            const rdata = buf.subarray(rdataStart, rdataEnd)
            pos = rdataEnd

            if (type === TYPE_A && rdlen === 4) {
                records.push({ name, type, data: `${rdata[0]}.${rdata[1]}.${rdata[2]}.${rdata[3]}` })
            } else if (type === TYPE_AAAA && rdlen === 16) {
                const groups: string[] = []
                for (let g = 0; g < 8; g++) groups.push(rdata.readUInt16BE(g * 2).toString(16))
                records.push({ name, type, data: groups.join(':') })
            } else if (type === TYPE_PTR || type === TYPE_CNAME) {
                const [target] = parseName(buf, rdataStart)
                records.push({ name, type, data: target.replace(/\.$/, '') })
            } else if (type === TYPE_SRV && rdlen >= 6) {
                const port = rdata.readUInt16BE(4)
                const [target] = parseName(buf, rdataStart + 6)
                records.push({ name, type, data: `${port} ${target.replace(/\.$/, '')}` })
            } else if (type === TYPE_TXT) {
                records.push({ name, type, data: Buffer.from(rdata) })
            }
        } catch {
            break // 单条记录坏了就停，别让整包报废
        }
    }
    return records
}

/** 构造一个 PTR 查询包：QD=1，问题是指定的域名 */
function buildQuery(name: string): Buffer {
    const labels = name.split('.').filter(Boolean)
    const qname: number[] = []
    for (const label of labels) {
        const bytes = Buffer.from(label, 'utf8')
        qname.push(bytes.length, ...bytes)
    }
    qname.push(0)
    const buf = Buffer.alloc(12 + qname.length + 4)
    buf.writeUInt16BE(0, 0) // ID=0（mDNS 允许）
    buf.writeUInt16BE(0x0000, 2) // flags: 标准查询
    buf.writeUInt16BE(1, 4) // QDCOUNT
    buf.writeUInt16BE(0, 6)
    buf.writeUInt16BE(0, 8)
    buf.writeUInt16BE(0, 10)
    Buffer.from(qname).copy(buf, 12)
    buf.writeUInt16BE(TYPE_PTR, 12 + qname.length)
    buf.writeUInt16BE(1, 12 + qname.length + 2) // QCLASS IN
    return buf
}

/** TXT record 是 length-prefixed 的 key=value 串，拼成对象 */
function parseTxt(buf: Buffer): Record<string, string> {
    const out: Record<string, string> = {}
    let pos = 0
    while (pos < buf.length) {
        const len = buf[pos]
        pos += 1
        if (pos + len > buf.length) break
        const kv = buf.subarray(pos, pos + len).toString('utf8')
        pos += len
        const eq = kv.indexOf('=')
        if (eq > 0) out[kv.slice(0, eq)] = kv.slice(eq + 1)
        else if (kv) out[kv] = ''
    }
    return out
}

type InstanceRef = { instance: string }

/**
 * 从应答里提取「服务实例」引用：PTR 记录 owner=_myagent._tcp.local，
 * rdata=MyAgent._myagent._tcp.local。只保留我们关心的两个服务类型。
 */
function extractInstances(records: DnsRecord[]): InstanceRef[] {
    const out: InstanceRef[] = []
    for (const r of records) {
        if (r.type !== TYPE_PTR || typeof r.data !== 'string') continue
        const owner = r.name.toLowerCase()
        for (const t of OUR_TYPES) {
            if (owner === `${t}.local`) {
                // PTR 的 rdata 就是 SRV/TXT 记录的 owner 名：
                // "InstanceName._myagent._tcp.local" —— 直接拿来查 byName 即可，
                // 不需要再剥服务类型（剥了反而对不上 SRV 记录名）
                out.push({ instance: r.data })
            }
        }
    }
    return out
}

/** CNAME 链解析：map 里 name → 目标域名，返回最终名字（最多跳 4 次防环） */
function resolveCname(name: string, cnames: Map<string, string>): string {
    let cur = name
    for (let i = 0; i < 4; i++) {
        const next = cnames.get(cur.toLowerCase())
        if (!next) return cur
        cur = next
    }
    return cur
}

/** 把一批应答记录拼成 Peer：实例 → SRV(端口+主机名) → A/AAAA(IP) → TXT(显示名) */
function assemblePeers(records: DnsRecord[]): Peer[] {
    const instances = extractInstances(records)
    if (instances.length === 0) return []

    // 按小写名索引，mDNS 名字大小写不敏感
    const byName = new Map<string, DnsRecord[]>()
    for (const r of records) {
        const key = r.name.toLowerCase()
        const list = byName.get(key) ?? []
        list.push(r)
        byName.set(key, list)
    }

    const cnames = new Map<string, string>()
    for (const [name, list] of byName) {
        for (const r of list) {
            if (r.type === TYPE_CNAME && typeof r.data === 'string') cnames.set(name, r.data)
        }
    }

    const peers: Peer[] = []
    const seen = new Set<string>() // 同一 ip:port 只出现一次（UI/API 两个服务类型可能指向同端口）

    for (const { instance } of instances) {
        // instance 已经是完整 FQDN（含 .local），直接查 SRV/TXT 记录；byName 的 key 是小写
        const list = byName.get(instance.toLowerCase()) ?? []

        // SRV：端口 + 目标主机名
        const srv = list.find((r) => r.type === TYPE_SRV && typeof r.data === 'string')
        if (!srv || typeof srv.data !== 'string') continue
        const [portStr, target] = srv.data.split(' ', 2)
        const port = Number(portStr)
        if (!Number.isInteger(port) || port <= 0) continue

        // A/AAAA：主机名 → IP
        const hostFqdn = resolveCname(target.replace(/\.$/, ''), cnames).toLowerCase()
        const hostRecords = byName.get(hostFqdn) ?? byName.get(`${hostFqdn}.local`) ?? []
        const aRec = hostRecords.find((r) => r.type === TYPE_A)
        const aaaaRec = hostRecords.find((r) => r.type === TYPE_AAAA)
        const ip = typeof aRec?.data === 'string' ? aRec.data : typeof aaaaRec?.data === 'string' ? aaaaRec.data : undefined
        if (!ip) continue

        // TXT：显示名
        const txtRec = list.find((r) => r.type === TYPE_TXT && Buffer.isBuffer(r.data))
        const txt = txtRec && Buffer.isBuffer(txtRec.data) ? parseTxt(txtRec.data) : {}
        const name = txt['name'] || instance.replace(/\._(?:myagent-api|myagent)\._tcp\.local$/, '').replace(/\.local$/, '')

        const dedupKey = `${ip}:${port}`
        if (seen.has(dedupKey)) continue
        seen.add(dedupKey)
        peers.push({ name, host: ip, port, url: `http://${ip}:${port}/`, lastSeen: Date.now() })
    }
    return peers
}

// ---------- browse 运行时 ----------

let sock: dgram.Socket | null = null
let queryTimer: NodeJS.Timeout | null = null
const allRecords = new Map<string, DnsRecord[]>() // key: 小写 owner name
const peersByHost = new Map<string, Peer[]>() // host → 该机器上的所有服务端口

function mergeRecords(records: DnsRecord[]) {
    for (const r of records) {
        const key = r.name.toLowerCase()
        const list = allRecords.get(key) ?? []
        // 同名同类型同数据去重，防止重复应答把 map 撑大
        const dup = list.some((x) => x.type === r.type && x.data === r.data)
        if (!dup) {
            list.push(r)
            allRecords.set(key, list)
        }
    }
}


/** 调试用：环境变量 MDNS_DEBUG=1 时打印收集到的原始记录 */
export function debugDumpRecords(): unknown {
    const flat: DnsRecord[] = []
    for (const list of allRecords.values()) flat.push(...list)
    return {
        recordCount: flat.length,
        records: flat.slice(0, 50).map((r) => ({ name: r.name, type: r.type, data: Buffer.isBuffer(r.data) ? `<txt ${r.data.length}B>` : r.data })),
        peers: assemblePeers(flat),
    }
}
function rebuildPeers() {
    // 把所有应答记录拍平成一个数组交给 assemblePeers
    const flat: DnsRecord[] = []
    for (const list of allRecords.values()) flat.push(...list)
    const now = Date.now()
    // 按 host 分组：同一台机器可能同时广播 UI 端口和 API 端口，UI 只显示一张卡片
    const byHost = new Map<string, Peer[]>()
    for (const peer of assemblePeers(flat)) {
        const list = byHost.get(peer.host) ?? []
        list.push({ ...peer, lastSeen: now })
        byHost.set(peer.host, list)
    }
    peersByHost.clear()
    for (const [host, list] of byHost) peersByHost.set(host, list)
}

function sendQueries() {
    if (!sock) return
    // allRecords 只增不减会随时间膨胀：超过上限时清掉重建（应答几秒内会补回来）
    if (allRecords.size > 500) allRecords.clear()
    // 先查服务类型枚举（能发现 _myagent 之外未来新增的服务），再直接查我们自己的两个类型
    const names = ['_services._dns-sd._udp.local', '_myagent._tcp.local', '_myagent-api._tcp.local']
    for (const name of names) {
        try {
            sock.send(buildQuery(name), MDNS_PORT, MDNS_ADDR)
        } catch {
            // 单个包发失败不影响其它
        }
    }
}

/** 启动浏览：绑 5353 收 mDNS 应答，每 5s 重发一次查询（应答是被动的，不问就没有） */
export function startBrowsing(): void {
    if (sock) return
    try {
        sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
        sock.on('message', (msg) => {
            try {
                mergeRecords(parseAnswers(msg))
                // 收到包就尝试重组 peer 列表（便宜，记录量小）
                rebuildPeers()
            } catch {
                // 坏包忽略
            }
        })
        sock.on('error', (err) => {
            console.warn('[discovery] mDNS 查询 socket 错误:', err.message)
        })
        sock.bind(MDNS_PORT, () => {
            try {
                sock?.addMembership(MDNS_ADDR)
                sock?.setMulticastTTL(255)
                sendQueries()
                queryTimer = setInterval(sendQueries, 5_000)
            } catch (err) {
                console.warn('[discovery] 加入 mDNS 组播失败:', err instanceof Error ? err.message : err)
            }
        })
    } catch (err) {
        console.warn('[discovery] 初始化 mDNS 浏览失败:', err instanceof Error ? err.message : err)
        sock = null
    }
}

export function stopBrowsing(): void {
    if (queryTimer) {
        clearInterval(queryTimer)
        queryTimer = null
    }
    try {
        sock?.close()
    } catch {
        // 已关闭就算了
    }
    sock = null
    allRecords.clear()
    peersByHost.clear()
}

/** 同一台机器上优先展示的端口：5173 是 Vite 开发 UI，3000 是 API/静态页 */
function preferredPort(peers: Peer[]): Peer {
    const ui = peers.find((p) => p.port === 5173)
    if (ui) return ui
    const api = peers.find((p) => p.port === 3000)
    if (api) return api
    return peers.reduce((a, b) => (a.port < b.port ? a : b))
}

/** 当前发现的 peer 列表：按主机去重，每台机器一张卡片；超过 TTL 的滤掉 */
export function listPeers(): Peer[] {
    const now = Date.now()
    const out: Peer[] = []
    for (const [host, peers] of peersByHost) {
        const fresh = peers.filter((p) => now - p.lastSeen <= PEER_TTL_MS)
        if (fresh.length === 0) {
            peersByHost.delete(host)
            continue
        }
        out.push(preferredPort(fresh))
    }
    return out
}

/** 组合入口：server.ts listen 之后调用 */
export function startDiscovery(name: string, ports: number[]): void {
    startAdvertising(name, ports)
    startBrowsing()
}

export function stopDiscovery(): void {
    stopBrowsing()
    void stopAdvertising()
}

/** 本机在局域网里的展示名：hostname 优先，拿不到用「My Agent」 */
export function localDisplayName(): string {
    try {
        return os.hostname() || 'My Agent'
    } catch {
        return 'My Agent'
    }
}
