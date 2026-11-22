import type { IncomingMessage } from 'node:http'
import { BODY_LIMIT } from '../config/index.ts'
import { HttpError } from './respond.ts'

/**
 * 读 JSON body。
 * 边读边累加长度，超限立刻中断 —— 不要先 concat 再判断，
 * 那样每来一个 chunk 就复制一遍整个数组，是 O(n²)。
 */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = []
    let size = 0

    for await (const chunk of req) {
        const buf = chunk as Buffer
        size += buf.length
        if (size > BODY_LIMIT) throw new HttpError(413, '请求体过大')
        chunks.push(buf)
    }

    if (size === 0) return {}

    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
        throw new HttpError(400, '请求体不是合法 JSON')
    }
}

/** 本项目所有 POST 都要一个 JSON 对象，数组/null 一律拒绝 */
export async function readJsonObject(req: IncomingMessage): Promise<Record<string, unknown>> {
    const body = await readJsonBody(req)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new HttpError(400, '请求体必须是 JSON 对象')
    }
    return body as Record<string, unknown>
}
