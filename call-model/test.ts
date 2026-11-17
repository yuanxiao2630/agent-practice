import http from 'http'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// === fileURLToPath ===
// 把 `file://` 格式的文件 URL，转换成操作系统原生的本地文件路径字符串
// Mac / Linux：`file:///Users/xxx/app/index.js` → `/Users/xxx/app/index.js`
// Windows：`file:///C:/project/app.js` → `C:\project\app.js`
console.log('fileURLToPath-before', import.meta.url)
console.log('fileURLToPath-after', fileURLToPath(import.meta.url))

// === path ===
// `path.dirname(p)`：获取一个路径的目录
console.log('path.dirname', path.dirname(fileURLToPath(import.meta.url)));


// === http.createServer ===
const server = http.createServer()
server.on('request', (req, res) => {
  // handler 逻辑
  console.log('我收到了请求', req.method, req.url, req.headers);

  res.setHeader('Content-Type', 'text/plain;charset=utf-8')
  res.end('hello 你成功连上4000啦！')
  
})
server.listen(4000, () => {
    console.log('4000 端口已经在监听中');
})


// === http.createServer SSE ===
const server_sse = http.createServer()
server_sse.on('request', (req, res) => {
    console.log('我收到了请求', req.method, req.url, req.headers);

    res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
    })

    res.write(`data: 你好\n\n`)

    setTimeout(() => {
      const msg2 = { content: '我是流式输出' }
      res.write(`data: ${JSON.stringify(msg2)}\n\n`)
    }, 1000)

    setTimeout(() => {
      res.end('hello 你成功连上 8000 啦！')
    }, 1000)
})
server_sse.listen(8000, () => {
    console.log('8000 端口已经在监听中');
})