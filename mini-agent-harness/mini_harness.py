#!/usr/bin/env python3
"""A tiny, dependency-free agent harness for learning purposes."""

from __future__ import annotations

import argparse
import json
import os
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any


SYSTEM_PROMPT = """\
You are a small file-workspace agent.

Use the supplied tools to complete the user's task. Inspect files before
editing them. After writing a file, read it back to verify the result. When
the task is complete, call the finish tool with a concise summary.
"""


TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": "List files in the isolated workspace.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read a UTF-8 text file from the isolated workspace.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Workspace-relative path."}
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Write a UTF-8 text file inside the isolated workspace.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Workspace-relative path."},
                    "content": {"type": "string", "description": "Complete file contents."},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "finish",
            "description": "Finish the task after verifying the result.",
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {"type": "string", "description": "What was completed."}
                },
                "required": ["summary"],
            },
        },
    },
]


class WorkspaceTools:
    """Small, path-confined tool collection."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _safe_path(self, relative_path: str) -> Path:
        candidate = (self.root / relative_path).resolve()
        if candidate != self.root and self.root not in candidate.parents:
            raise ValueError("Path escapes the isolated workspace")
        return candidate

    def execute(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if name == "list_files":
            files = sorted(
                str(path.relative_to(self.root))
                for path in self.root.rglob("*")
                if path.is_file()
            )
            return {"files": files}

        if name == "read_file":
            path = self._safe_path(str(arguments["path"]))
            if not path.is_file():
                raise FileNotFoundError(f"No such file: {arguments['path']}")
            if path.stat().st_size > 100_000:
                raise ValueError("File is larger than the 100 KB learning-demo limit")
            return {"path": str(arguments["path"]), "content": path.read_text("utf-8")}

        if name == "write_file":
            path = self._safe_path(str(arguments["path"]))
            content = str(arguments["content"])
            if len(content.encode("utf-8")) > 100_000:
                raise ValueError("Content is larger than the 100 KB learning-demo limit")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
            return {"path": str(arguments["path"]), "bytes_written": len(content.encode("utf-8"))}

        if name == "finish":
            return {"finished": True, "summary": str(arguments["summary"])}

        raise ValueError(f"Unknown tool: {name}")


def tool_call(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": f"call_{uuid.uuid4().hex[:10]}",
        "type": "function",
        "function": {"name": name, "arguments": json.dumps(arguments, ensure_ascii=False)},
    }


class MockModel:
    """A deterministic stand-in that makes the agent loop visible without an API key."""

    def complete(
        self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]
    ) -> dict[str, Any]:
        del tools
        tool_messages = [message for message in messages if message["role"] == "tool"]

        if not tool_messages:
            return {
                "role": "assistant",
                "content": "我先查看工作区。",
                "tool_calls": [tool_call("list_files", {})],
            }

        last_result = json.loads(tool_messages[-1]["content"])
        last_name = tool_messages[-1].get("name")

        if last_name == "list_files":
            return {
                "role": "assistant",
                "content": "发现 brief.txt，先读取任务材料。",
                "tool_calls": [tool_call("read_file", {"path": "brief.txt"})],
            }

        if last_name == "read_file" and last_result.get("path") == "brief.txt":
            source = last_result["content"]
            items = [
                line.strip()[2:].strip()
                for line in source.splitlines()
                if line.strip().startswith("- ")
            ]
            summary = "# 本周项目摘要\n\n" + "\n".join(
                f"{index}. {item}" for index, item in enumerate(items, start=1)
            )
            summary += "\n"
            return {
                "role": "assistant",
                "content": "我将材料整理成结构化摘要。",
                "tool_calls": [
                    tool_call(
                        "write_file",
                        {"path": "summary.md", "content": summary},
                    )
                ],
            }

        if last_name == "write_file":
            return {
                "role": "assistant",
                "content": "文件已写入，现在读回检查。",
                "tool_calls": [tool_call("read_file", {"path": "summary.md"})],
            }

        if last_name == "read_file" and last_result.get("path") == "summary.md":
            return {
                "role": "assistant",
                "content": "结果检查通过。",
                "tool_calls": [
                    tool_call(
                        "finish",
                        {"summary": "已读取 brief.txt、生成 summary.md，并读回验证。"},
                    )
                ],
            }

        return {
            "role": "assistant",
            "content": "出现了演示脚本未预期的状态。",
            "tool_calls": [
                tool_call("finish", {"summary": "演示提前结束，请检查运行轨迹。"})
            ],
        }


class DeepSeekModel:
    """Minimal DeepSeek Chat Completions adapter using only Python stdlib."""

    def __init__(self, model: str) -> None:
        api_key = os.environ.get("DEEPSEEK_API_KEY")
        if not api_key:
            raise RuntimeError("请先设置环境变量 DEEPSEEK_API_KEY")
        self.api_key = api_key
        self.model = model
        self.base_url = os.environ.get(
            "DEEPSEEK_BASE_URL", "https://api.deepseek.com"
        ).rstrip("/")

    def complete(
        self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]
    ) -> dict[str, Any]:
        body = json.dumps(
            {
                "model": self.model,
                "messages": messages,
                "tools": tools,
                "tool_choice": "auto",
                "stream": False,
            },
            ensure_ascii=False,
        ).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            details = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"DeepSeek API error {error.code}: {details}") from error
        return payload["choices"][0]["message"]


class AgentHarness:
    """Orchestrates model decisions, tool execution, memory, limits, and tracing."""

    def __init__(
        self,
        model: MockModel | DeepSeekModel,
        workspace: Path,
        trace_path: Path,
        max_steps: int,
    ) -> None:
        self.model = model
        self.tools = WorkspaceTools(workspace)
        self.trace_path = trace_path
        self.max_steps = max_steps
        self.trace_path.parent.mkdir(parents=True, exist_ok=True)
        self.trace_path.write_text("", encoding="utf-8")

    def _record(self, event: dict[str, Any]) -> None:
        event = {"timestamp": time.time(), **event}
        with self.trace_path.open("a", encoding="utf-8") as trace:
            trace.write(json.dumps(event, ensure_ascii=False) + "\n")

    def run(self, task: str) -> str:
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": task},
        ]
        self._record({"event": "task_started", "task": task})

        for step in range(1, self.max_steps + 1):
            print(f"\n── Step {step}: 模型决策")
            assistant = self.model.complete(messages, TOOL_SCHEMAS)
            messages.append(assistant)
            self._record({"event": "model_response", "step": step, "message": assistant})

            if assistant.get("content"):
                print(f"模型：{assistant['content']}")

            calls = assistant.get("tool_calls") or []
            if not calls:
                result = str(assistant.get("content") or "模型未调用工具，任务结束。")
                self._record({"event": "task_stopped", "reason": "no_tool_call", "result": result})
                return result

            for call in calls:
                name = call["function"]["name"]
                raw_arguments = call["function"].get("arguments") or "{}"
                arguments = (
                    json.loads(raw_arguments)
                    if isinstance(raw_arguments, str)
                    else raw_arguments
                )
                print(f"工具：{name}({json.dumps(arguments, ensure_ascii=False)})")

                try:
                    result_data = self.tools.execute(name, arguments)
                    result_data = {"ok": True, **result_data}
                except Exception as error:  # Tool errors become observations for the model.
                    result_data = {"ok": False, "error": f"{type(error).__name__}: {error}"}

                print(f"结果：{json.dumps(result_data, ensure_ascii=False)}")
                self._record(
                    {
                        "event": "tool_result",
                        "step": step,
                        "tool": name,
                        "arguments": arguments,
                        "result": result_data,
                    }
                )
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call["id"],
                        "name": name,
                        "content": json.dumps(result_data, ensure_ascii=False),
                    }
                )

                if name == "finish" and result_data.get("ok"):
                    summary = str(result_data["summary"])
                    self._record({"event": "task_finished", "summary": summary})
                    return summary

        result = f"达到最大步数 {self.max_steps}，Harness 强制停止。"
        self._record({"event": "task_stopped", "reason": "max_steps", "result": result})
        return result


def parse_args() -> argparse.Namespace:
    script_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description="体验一个最小 Agent Harness")
    parser.add_argument(
        "--backend",
        choices=("mock", "deepseek"),
        default="mock",
        help="mock 无需 API Key；deepseek 使用真实模型",
    )
    parser.add_argument(
        "--task",
        default="读取 brief.txt，将事项整理为 summary.md，并检查写入结果。",
    )
    parser.add_argument("--workspace", type=Path, default=script_dir / "sandbox")
    parser.add_argument("--trace", type=Path, default=script_dir / "runs" / "trace.jsonl")
    parser.add_argument(
        "--model",
        default=os.environ.get("DEEPSEEK_MODEL", "deepseek-flash"),
    )
    parser.add_argument("--max-steps", type=int, default=10)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    model: MockModel | DeepSeekModel
    model = MockModel() if args.backend == "mock" else DeepSeekModel(args.model)
    harness = AgentHarness(model, args.workspace, args.trace, args.max_steps)
    result = harness.run(args.task)
    print(f"\n✅ Harness 结束：{result}")
    print(f"🧾 完整轨迹：{args.trace.resolve()}")


if __name__ == "__main__":
    main()
