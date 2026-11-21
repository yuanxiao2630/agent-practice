import type OpenAI from 'openai'

export * from './file-tools.ts'
export * from './web-seatch-tools.ts'

// 标注成 SDK 的类型，否则 type: "function" 会被推断成 string，传给 create() 时类型不匹配
export const tools: OpenAI.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "readFileContent",
      description: "读取当前活跃仓库内的文本文件，传入相对仓库根的路径，返回完整文本",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "相对仓库根路径，如 src/index.ts" }
        },
        required: ["filePath"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "findFunctionLine",
      description: "在指定文件中查找函数定义，返回函数起始行号（1开始），找不到返回null",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "文件相对路径" },
          funcName: { type: "string", description: "要查找的函数名" }
        },
        required: ["filePath", "funcName"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "listWorkspaceEntries",
      description: "列出仓库根目录下一级条目，区分文件/文件夹，不递归扫描子目录",
      parameters: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "searchWeb",
      description: "当需要联网搜索时，调用这个工具",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "要搜索的内容"}
        },
        required: ["query"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "chatRoom",
      description: "加入/离开/发送消息/读取局域网聊天室。房间是同 WiFi 下其他人开的命名频道，你可以作为参与者进房聊天",
      parameters: {
        type: "object",
        properties: {
          room: { type: "string", description: "房间名（不存在时 join 会自动创建）" },
          action: { type: "string", enum: ["join", "leave", "send", "read"], description: "join 加入 / leave 离开 / send 发言 / read 读历史" },
          text: { type: "string", description: "send 时的消息内容" }
        },
        required: ["room", "action"],
        additionalProperties: false
      }
    }
  }
]

