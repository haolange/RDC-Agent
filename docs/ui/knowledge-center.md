# Knowledge Center

知识中心是 Workbench 左侧边栏底部、用户条上方的常驻入口，打开视窗比例驱动的实色分层模态（`min(92vw, 1920px) × min(90vh, 1240px)`；`≤960px` 时三列切换，`≤640px` 全屏）。它只消费已落地的五服务：`Query` / `Index` / `Compile` / `Candidate` / `Write`，不另开 browse 双轨或派生存储。

## 信息架构

三列网格：`224px / minmax(280px, 0.8fr) / 1.2fr`；中列可换行。

顶部标题栏提供全局「导入知识 / 导出知识」两个动作，两者都打开任务子弹窗。

1. **Spaces / 控制列**：Brand、Cards / Candidates / Conflicts 三段切换、User + 已注册 Project 多选（默认全选）、结构索引状态与「索引维护」折叠面板（重建为次级按钮）。Semantic lane 与 Settings Embedding 重建入口已删除。
2. **List**：搜索框（300ms debounce）驱动 `knowledge:query`；类型 / 生命周期 / 六条检索通道收进「筛选」`Popover`，以 `CheckPill` 表达多选。Cards 按服务返回的 `hits` 顺序渲染，渲染层不得重排。Candidates 分 `listCandidates` 与 `listStagedDrafts` 两段。Conflicts 渲染当前 pack 的 `contradicts`。列表为空时把「导入知识」放在列表内容起始区，不只留在左下。
3. **Detail**：标题、relativePath、关闭按钮、元数据（默认折叠）、`MessageMarkdown` 正文、写操作。`sourceStatus === 'fixed'` 永远带 “≠ verified”。任一写操作只打开写入确认弹窗，不直接落盘。

导入、导出与写入确认都是 `TaskDialog`（见 `docs/ui/design-system.md`「任务子弹窗」），叠在三列之上：背景空间、筛选、选择与滚动位置保留，关闭后恢复原阅读状态；Escape 只作用最上层。导入的文件 / 粘贴 / 结果是同一个弹窗内的状态，不逐层叠窗。

窄屏 `≤960px` 只渲染一列，顶部三段 Spaces / List / Detail 与常驻关闭；选中卡片进入 Detail，Detail 提供返回。`≤640px` 任务子弹窗全屏。

## 产品边界

- 持久写入只能经 `KnowledgeWriteService.write/promote`，且 `confirmation.explicitHumanConfirmation === true`；`FullAccess` 不得绕过。
- Candidate 只能经 `createCandidate({ explicitUserIntent: true })`，必须由用户点击触发。
- 导入只走 `ingestColdDataToStaging`（Draft / quarantine / conflict），**不得**导入即 Candidate，也不得批量提升。用户文案统一「导入知识 / 导出知识」；`ColdData` 只保留为内部 schema / 技术名，不出现在界面。
- 导出经 `KnowledgeExportService`，格式二选一：**知识包**（`rdc.knowledge-package/1`，单文件 YAML，可再导入）与 **Markdown**（阅读用途，不可再导入）。范围为当前选中卡片 / 当前筛选结果 / 指定空间，数量实时计算。导出包剔除 `sourceHash` / `sourceMtimeMs` / `sourceSize` 与任何绝对路径，复用导入同一套 secret 扫描；绝不导出凭据、provider 配置或会话数据。导出包的 `lifecycle` 只是元数据，再导入一律落 session Draft（`verified: false`），重复 `cardId` 走既有 conflict 路径。保存位置由系统保存对话框选定，取消不产生半成品。
- 禁止声称语义检索。Semantic lane 开关与 Settings > Models Embedding 重建入口已删除。
- Center 的 Rebuild Index 只重建 `KnowledgeIndexService` 结构索引。
- `change reason` 与 `rollback basis` 只做确认门禁，不落盘。
- 不做 Repo Wiki、Memory 页签、自动生成、重新生成或有用/无用反馈。

## 实现锚点

| 层 | 路径 |
|----|------|
| 入口 | `src/renderer/app/WorkbenchShell.tsx`（`sidebar-knowledge-center-trigger`） |
| 模态 | `src/renderer/features/knowledge/KnowledgeCenterModal/` |
| 主进程 | `src/main/knowledge/` 五服务 + `KnowledgeExportService`；IPC `src/main/ipc/knowledgeHandlers.ts` |
| Renderer API | `src/shared/renderer-api/core.ts`（Desktop / Browser 共用） |
| 类型 | `src/shared/types/knowledge.ts`、`src/shared/types/knowledgeExport.ts` |

IPC 通道：`knowledge:overview` / `query` / `card` / `compile` / `index:rebuild` / `candidates` / `candidateCreate` / `coldDataImport` / `issueApprovalToken` / `write` / `promote` / `export`。写/提升必须消费 Main 签发的 `approvalToken`，并带 `explicitHumanConfirmation`；`knowledge:export` 为 `high-impact`，目标路径由 `dialog:saveFile` 的系统保存对话框返回，renderer 不得自行拼绝对路径。已删除 browse-only 的 `knowledge:listSpaces` / `listCards` / `getCard`。

权威产品边界见根目录 `DESIGN.md`「Knowledge」。
