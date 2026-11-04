# 从 0 到 1 体验 Agent Harness

这个项目不是完整产品，而是一个故意保持很小的教学实现。它把 Agent Harness
最关键的机制放在一个 Python 文件里，且只使用 Python 标准库。

## 先运行无需 API Key 的版本

```bash
cd "/Users/johnathanwang/Desktop/agent practice/mini-agent-harness"
python3 mini_harness.py
```

运行时请观察这个循环：

```text
模型决定下一步
  → Harness 校验并执行工具
  → 工具结果加入上下文
  → 模型根据结果决定下一步
  → 完成或触发最大步数停止
```

然后查看 Agent 创建的文件和完整轨迹：

```bash
cat sandbox/summary.md
cat runs/trace.jsonl
```

## 切换到真实 DeepSeek 模型

先在当前终端设置 API Key。不要把真实 Key 写入代码或提交到 Git：

```bash
export DEEPSEEK_API_KEY="你的 API Key"
python3 mini_harness.py --backend deepseek
```

如需指定当前可用的其他模型：

```bash
export DEEPSEEK_MODEL="模型名称"
python3 mini_harness.py --backend deepseek
```

## 哪些部分属于 Harness？

- `SYSTEM_PROMPT`：规定 Agent 的行为边界。
- `TOOL_SCHEMAS`：告诉模型有哪些工具以及参数格式。
- `WorkspaceTools`：真正执行文件操作，并阻止路径逃逸。
- `MockModel` / `DeepSeekModel`：可替换的模型适配器。
- `AgentHarness.run()`：模型—工具—观察结果的主循环。
- `max_steps`：停止条件，避免无限循环。
- `runs/trace.jsonl`：可观测、可调试、可评测的执行轨迹。

## 建议做三个小实验

1. 把 `--max-steps` 改成 `2`，观察 Harness 如何强制停止。
2. 把 `brief.txt` 改名，观察工具错误如何成为模型的新观察结果。
3. 使用真实 DeepSeek 后，换一个任务，观察模型能否自主组合工具。

## Harness 与 Benchmark 的关系

Harness 负责“让 Agent 跑起来”；Benchmark 负责“给它统一任务并打分”。
如果再添加一批固定输入、预期输出和评分器，这个项目就可以继续扩展成一个
最小 Agent Benchmark。
