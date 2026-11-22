import type OpenAI from 'openai'

export * from './file-tools.ts'
export * from './web-seatch-tools.ts'

// 标注成 SDK 的类型，否则 type: "function" 会被推断成 string，传给 create() 时类型不匹配
export const tools: OpenAI.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "readFileContent",
      description: "读取用户所选仓库内的文本文件，传入相对仓库根的路径，返回完整文本；不能读取仓库外的文件",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "相对仓库根的路径，如 src/index.ts（不能是绝对路径）" }
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
      description: "在所选仓库的指定文件中查找函数定义，返回函数起始行号（1开始），找不到返回null",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "相对仓库根的文件路径" },
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
      description: "列出所选仓库内某个目录的一级条目，区分文件/文件夹，不递归扫描子目录",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对仓库根的目录路径，默认根目录（如 server/tools）" }
        },
        required: [],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
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
  }
]

