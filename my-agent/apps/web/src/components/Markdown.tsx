import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

// 模型输出本来就是 markdown（标题、列表、表格、代码块），这里统一渲染成 HTML。
// 不开启 rehype-raw：模型给的原始 HTML 一律当纯文本，避免注入。
const components: Components = {
    a: ({ href, children }) => (
        <a href={href} target="_blank" rel="noreferrer noopener">
            {children}
        </a>
    ),
    // 表格容易比气泡宽，包一层容器单独横向滚动，不把整页撑开
    table: ({ children }) => (
        <div className="md-table">
            <table>{children}</table>
        </div>
    ),
}

export default function Markdown({ text }: { text: string }) {
    return (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {text}
        </ReactMarkdown>
    )
}
