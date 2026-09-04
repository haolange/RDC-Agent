# Knowledge Center

知识中心是 Workbench 左侧边栏底部、用户条上方的常驻入口，打开视窗比例驱动的毛玻璃模态（`min(92vw, 1920px) × min(90vh, 1240px)`；`≤640px` 时单列堆叠）。它只消费已落地的五服务：`Query` / `Index` / `Compile` / `Candidate` / `Write`，不另开 browse 双轨或派生存储。

## 信息架构

三列网格：`minmax(272px, 300px) minmax(320px, 380px) minmax(0, 1fr)`。

1. **Spaces / 控制列**：Brand、Cards / Candidates / Conflicts 三段切换、User + 已注册 Project 多选（默认全选）、type / lifecycle 过滤、六 lane 开关、结构索引状态与 `Rebuild Index`、`Import ColdData…`。Semantic lane 与 Settings Embedding 重建入口已删除。
2. **List**：搜索框（300ms debounce）驱动 `knowledge:query`。Cards 按服务返回的 `hits` 顺序渲染，渲染层不得重排。Candidates 分 `listCandidates` 与 `listStagedDrafts` 两段。Conflicts 渲染当前 pack 的 `contradicts`。
3. **Detail**：标题、relativePath、关闭按钮、元数据、`MessageMarkdown` 正文、写操作。`sourceStatus === 'fixed'` 永远带 “≠ verified”。任一写操作只打开确认面板，不直接落盘。

窄屏 `≤640px` 只渲染一列，顶部三段 Spaces / List / Detail；选中卡片进入 Detail，Detail 提供返回。Import 与写确认在窄屏为全高 sheet。Escape 优先关面板，再关模态。

## 产品边界

- 持久写入只能经 `KnowledgeWriteService.write/promote`，且 `confirmation.explicitHumanConfirmation === true`；`FullAccess` 不得绕过。
- Candidate 只能经 `createCandidate({ explicitUserIntent: true })`，必须由用户点击触发。
- ColdData Import 只走 `ingestColdDataToStaging`（Draft / quarantine / conflict），**不得**导入即 Candidate，也不得批量提升。
- 禁止声称语义检索。Semantic lane 开关与 Settings > Models Embedding 重建入口已删除。
- Center 的 Rebuild Index 只重建 `KnowledgeIndexService` 结构索引。
- `change reason` 与 `rollback basis` 只做确认门禁，不落盘。
- 不做 Repo Wiki、Memory 页签、自动生成、重新生成或有用/无用反馈。

## 实现锚点

| 层 | 路径 |
|----|------|
| 入口 | `src/renderer/app/WorkbenchShell.tsx`（`sidebar-knowledge-center-trigger`） |
| 模态 | `src/renderer/features/knowledge/KnowledgeCenterModal/` |
| 主进程 | `src/main/knowledge/` 五服务；IPC `src/main/ipc/knowledgeHandlers.ts` |
| Renderer API | `src/shared/renderer-api/core.ts`（Desktop / Browser 共用） |
| 类型 | `src/shared/types/knowledge.ts` |

IPC 通道：`knowledge:overview` / `query` / `card` / `compile` / `index:rebuild` / `candidates` / `candidateCreate` / `coldDataImport` / `issueApprovalToken` / `write` / `promote`。写/提升必须消费 Main 签发的 `approvalToken`，并带 `explicitHumanConfirmation`。已删除 browse-only 的 `knowledge:listSpaces` / `listCards` / `getCard`。

权威产品边界见根目录 `DESIGN.md`「Knowledge」。
