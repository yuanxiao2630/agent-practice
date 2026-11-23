import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import { BODY_LIMIT } from '../config/index.ts'
import { HttpError } from './errors.ts'

/**
 * 原版是手写 readJsonBody：边读边累加、超限中断。
 * Express 里直接换成 body-parser 中间件，413 / 非法 JSON 都交给它，
 * 这里只补一条业务约束：本项目所有 POST 的 body 必须是 JSON 对象。
 *
 * type: () => true 表示不挑 content-type —— 与原版行为一致（原版根本不看这个头）。
 */
const parseJson = express.json({
    limit: BODY_LIMIT,
    strict: true,
    type: () => true,
})

/** 只挂在需要的 POST 路由上，GET / cancel / reset 不读 body */
export function readJsonObject(req: Request, res: Response, next: NextFunction): void {
    parseJson(req, res, (err?: unknown) => {
        if (err) {
            next(err)
            return
        }

        // 空 body 时 body-parser 可能留 undefined；统一成 {}，让字段校验报更具体的错
        if (req.body === undefined || req.body === null) {
            req.body = {}
            next()
            return
        }

        if (typeof req.body !== 'object' || Array.isArray(req.body)) {
            next(new HttpError(400, '请求体必须是 JSON 对象'))
            return
        }

        next()
    })
}

/** 经过 readJsonObject 之后，body 一定是普通对象；这里只做类型收口 */
export function bodyOf(req: Request): Record<string, unknown> {
    return req.body as Record<string, unknown>
}
