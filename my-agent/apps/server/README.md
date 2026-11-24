# 本地 Agent 服务的 checkpoint

本说明对应 `npm start` / `npm run dev:server` 启动的 `apps/server`。

## 文件位置

- 默认 checkpoint：项目根目录的 `logs/checkpoint.json`。
- 事件日志：`logs/sessions/<sessionId>.jsonl`，保留原来的日志格式。
- 可用 `CHECKPOINT_FILE` 指定 checkpoint 文件路径，用 `LOG_DIR` 指定日志目录。
- 当前是单用户、单进程、一个活跃会话，只保存最近的会话现场。

## 保存内容与时机

checkpoint 包含版本、会话 ID、最近任务、完整 `messages`（含 system、tool_calls 和工具回执）、工作区，以及模型、最大轮次、当前轮次、下一步动作和未完成工具调用 ID。

`lastEventSeq` 沿用现有协议的 **task 内序号**，需与 `task.taskId` 和 `sessionId` 一起定位 JSONL；新任务从 1 开始，清空上下文后为 0。

加入用户消息、请求模型前、提交模型回复后、提交每个工具回执后，以及任务完成、失败、取消时保存。清空上下文和切换/取消工作区也会立即保存，并清除旧任务。

写入通过串行队列执行。每次先序列化固定快照，再写同目录的 `checkpoint.json.tmp`，同步文件后 rename 覆盖正式文件，并同步目录。存储失败会停止本次执行、报告错误并释放运行锁。临时文件不会被用于恢复。

checkpoint 保存成功后才推送对应 SSE 事件。JSONL 延续现有的 best-effort 策略，写入失败只报告到服务端日志。两种文件不构成事务，恢复以 checkpoint 为准，不自动重放 JSONL；`lastEventSeq` 不表示两个文件拥有事务一致性。

## 启动恢复

服务在监听端口前读取并校验 checkpoint。文件不存在时正常创建空会话；版本错误、JSON 损坏或字段不合法时明确报错，保留原文件，不静默覆盖。

恢复会话 ID、消息和最近任务。工作区重新检查存在性、目录类型及读取权限，检查失败则取消选择、更新 system 提示词并保留其余历史。

上次为 `pending` 或 `running` 的任务改为 `interrupted`，记录结束时间和中断原因。只给尚缺回执的工具补一条“服务重启，结果未知”的错误回执，已有回执不变。修补后的现场重新保存，后续重启不会重复补充。

恢复不创建 `AbortController`，不设置活跃任务，不请求模型或重跑工具。用户可以在恢复的上下文中发起下一次提问；可通过 `GET /api/context` 检查任务及消息，通过 `GET /api/history` 获取页面历史和中断标记。

## 当前恢复范围

恢复到最后一次成功提交的 checkpoint。进程退出前尚未保存的进展可能丢失；正在执行的工具可能已产生副作用，恢复不会判断或重试它。`execution.nextAction` 用于记录原现场，显式继续旧任务及工具幂等重试尚未实现。

正常关闭服务时会取消当前任务并等待保存，工具不响应取消时最多等待 3 秒，再刷新已排队的存储操作。

## 验证

```sh
npm run typecheck
npm test
```

测试使用临时目录和本地模型替身，覆盖原子写入、快照复制、文件损坏、磁盘失败、缺失回执修补、工作区失效、完整任务事件、取消和真实新进程恢复，不调用外部模型。
