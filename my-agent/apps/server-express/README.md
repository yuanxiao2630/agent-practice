# apps/server-express

`apps/server` 的 **Express 5** 重构版。原 `apps/server` 目录及其内容完全未改动，两个服务可以独立运行、对照阅读。

## 快速开始

```bash
# 1. 安装依赖（根目录执行一次）
npm install

# 2. 准备环境变量
#    仓库里已经复制了一份 apps/server-express/.env（未提交，含真实 key）；
#    如果换了机器 / 文件不存在，再从示例复制并填写：
#    cp apps/server-express/.env.example apps/server-express/.env

# 3. 启动（默认 127.0.0.1:3000，与原 server 相同）
npm run dev:express        # 只启动 API；另开终端 npm run dev:web 启动页面
npm run start:express      # 直接启动，需要先 npm run build

# 4. 测试 / 类型检查
npm run test:express
npm run typecheck
```

> `/api` 的开发代理仍指向 `3000`，所以 `npm run dev:express` + `npm run dev:web` 可以直接配合使用。
> Express 版和原版默认端口相同，**不要同时启动**；需要并存时改 `apps/server-express/.env` 里的 `PORT`。

## 目录

```
apps/server-express/
├── index.ts              # 入口：配置检查、MCP 初始化、监听、优雅退出
├── .env.example          # 环境变量示例
├── scripts/              # MCP 调试脚本（同原版）
└── src/
    ├── config/           # 环境变量与路径
    ├── agent/            # Agent 循环、工具、提示词
    ├── mcp/              # 高德 MCP 客户端
    ├── session.ts        # 单会话上下文与运行状态
    ├── task-state.ts     # 任务状态类型
    ├── util/workspace.ts # 工作区目录校验与浏览
    └── http/             # ★ 本次用 Express 重写的部分
        ├── app.ts        # 组装应用、注册路由、405/404 兜底
        ├── body.ts       # express.json + 「body 必须是对象」
        ├── errors.ts     # HttpError、sendJson、统一 error middleware
        ├── sse.ts        # SSE 响应封装
        ├── static.ts     # express.static + SPA 兜底
        └── routes/       # chat / history / tools / workspace
```

## 从 `node:http` 到 Express 的对应关系

| 原实现 (`apps/server/src/http`) | Express 版 (`apps/server-express/src/http`) |
| --- | --- |
| `http.createServer(handler)` | `express()` + `app.listen()` |
| `routes` 表里手工 `method + path` 精确匹配 | `app.get/post/delete(path, handler)` 注册 |
| 手写 `readJsonBody` / `readJsonObject` | `express.json()` 中间件 + `bodyOf()` |
| `sendJson(res, status, data)` 手写头部 | `res.status(status).json(data)` |
| 手写 `startSse` 响应头与断连判断 | 保留 `res.write`，用 `res.flushHeaders()` 立即下发 |
| 手写 MIME 表 + 目录穿越校验 + HEAD | `express.static()` + `res.sendFile()` SPA 兜底 |
| `try/catch` + `handleError` | 4 参数 error middleware（Express 5 自动捕获 async 异常） |
| 路径存在但方法不对时手工 405 | `/api` 兜底中间件按路由表判断 405/404 |

### 有意保留的行为

- API 路径、请求/响应结构、错误文案与状态码与原版一致；
- POST 的 body 不依赖 `content-type`，且必须是 JSON 对象；
- 单请求体上限 `BODY_LIMIT`（默认 1 MB），超限 413；
- 未选工作区时普通对话可用，文件工具会收到「未选择工作区」；
- 同一时刻只允许一轮对话，运行中切换工具 / 仓库返回 409；
- SSE 仍以 `data: {...}\n\n` 发送，结尾补 `data: [DONE]`。

## 为什么复制了业务层

要求是「原 server 目录及内容不要修改」。若让新 server 直接 import 原目录的内部模块，两个应用会形成隐式耦合，原版也无法独立演进；因此这里把 `agent / session / workspace / mcp` 一并复制过来，只重写 HTTP 层。

后续如果希望消除重复，可以把这些模块抽到 `packages/agent-core`，再让两个 app 同时依赖它——那会需要改原版的 import，属于另一项独立重构。

## API 一览

| Method | Path | 说明 |
| --- | --- | --- |
| POST | `/api/chat` | 提问，SSE 流式返回 |
| POST | `/api/chat/cancel` | 中断当前轮 |
| GET | `/api/history` | 页面回显用的消息 |
| GET | `/api/context` | 排查用的完整上下文与任务状态 |
| POST | `/api/reset` | 清空上下文 |
| GET/POST/DELETE | `/api/workspace` | 查询 / 选择 / 取消工作区 |
| GET | `/api/workspace/browse` | 浏览一级目录 |
| GET | `/api/tools` | 工具列表与开关状态 |
| POST | `/api/tools/toggle` | 单个或按来源开关工具 |
