# Knowledge Center

知识中心是 Workbench 左侧边栏底部、用户条上方的常驻入口，打开比 Settings 更大的毛玻璃模态，浏览 User space 与全部已注册 Project 的 `knowledge/` markdown 卡片。

## 产品边界

- 单页主从布局：左侧空间树 + 搜索，右侧卡片正文（`MessageMarkdown`）。
- 不做 Repo Wiki、Memory 页签、自动生成、重新生成、Commit 元数据或有用/无用反馈。
- 强调色跟随 Appearance chrome / 语义 token，不写死第三方翠绿。
- 跨 project 按选中 `spaceId` 隔离；卡片路径不得逃逸对应 `knowledge/` 根目录。

## 实现锚点

| 层 | 路径 |
|----|------|
| 入口 | `src/renderer/app/WorkbenchShell.tsx`（`sidebar-knowledge-center-trigger`） |
| 模态 | `src/renderer/features/knowledge/KnowledgeCenterModal/` |
| 主进程 | `src/main/runtime/KnowledgeBrowseService.ts`、`src/main/ipc/knowledgeHandlers.ts` |
| Renderer API | `src/shared/renderer-api/core.ts`（Desktop / Browser 共用） |
| 类型 | `src/shared/types/knowledge.ts` |

权威产品边界见根目录 `DESIGN.md`「Memory and Knowledge」。
