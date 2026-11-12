export const tools = [
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
  }
]

