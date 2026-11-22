import { cancelChatRoute, chatRoute } from './chat.ts'
import { contextRoute, historyRoute, resetRoute } from './history.ts'
import { getToolsRoute, toggleToolRoute } from './tools.ts'
import {
    browseWorkspaceRoute,
    clearWorkspaceRoute,
    getWorkspaceRoute,
    selectWorkspaceRoute,
} from './workspace.ts'
import type { Route } from './types.ts'

/**
 * 路由表：精确匹配 method + pathname。
 * 端点还少，用表比 if 链好读；超过 20 个再考虑路径参数和前缀匹配。
 */
export const routes: Route[] = [
    // 对话
    { method: 'POST', path: '/api/chat', handler: chatRoute },
    { method: 'POST', path: '/api/chat/cancel', handler: cancelChatRoute },
    { method: 'GET', path: '/api/history', handler: historyRoute },
    { method: 'GET', path: '/api/context', handler: contextRoute },
    { method: 'POST', path: '/api/reset', handler: resetRoute },

    // 工作区
    { method: 'GET', path: '/api/workspace', handler: getWorkspaceRoute },
    { method: 'POST', path: '/api/workspace', handler: selectWorkspaceRoute },
    { method: 'DELETE', path: '/api/workspace', handler: clearWorkspaceRoute },
    { method: 'GET', path: '/api/workspace/browse', handler: browseWorkspaceRoute },

    // 工具
    { method: 'GET', path: '/api/tools', handler: getToolsRoute },
    { method: 'POST', path: '/api/tools/toggle', handler: toggleToolRoute },
]
