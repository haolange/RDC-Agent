# Knowledge Center

知识中心是 Workbench 左侧边栏底部、用户条上方的常驻入口，打开居中实色分层模态（在 `88vw × 86vh`、硬顶 `120rem × 70rem` 内接最大 16:10，backdrop `--modal-workbench-inset`；`≤960px` 时三列切换，`≤640px` 全屏）。它只消费已落地的五服务：`Query` / `Index` / `Compile` / `Candidate` / `Write`，不另开 browse 双轨或派生存储。

## 信息架构

三列网格：`224px / minmax(280px, 0.8fr) / 1.2fr`；中列可换行。

顶部标题栏提供全局「导入知识 / 导出知识」两个动作，两者都打开任务子弹窗。

1. **Spaces / 控制列**：Brand、Cards / Candidates / Conflicts 三段切换、User + 已注册 Project 多选（默认全选）、「索引维护」折叠面板：当前状态 / 卡片数 / 构建时间三行、完整 revision 加复制按钮、重建为次级按钮并附说明；索引是可重建的派生数据。Semantic lane 与 Settings Embedding 重建入口已删除。
2. **List**：Cards 视图有搜索框（300ms debounce）驱动 `knowledge:query`；类型 / 生命周期 / 六条检索通道收进「筛选」`Popover`，以 `CheckPill` 表达多选。Cards 行渲染标题 + 类型/生命周期徽章、一行预览（来自索引 `preview`，未重建索引时缺省）与 `updatedAt`（本地 `YYYY-MM-DD HH:mm`），顺序按服务返回的 `hits`，渲染层不得重排。Candidates / Conflicts 视图把搜索与筛选换成列表头（标题 + 计数 + 一句说明）：Candidates 只列 `listCandidates`，行尾「待审核」徽章，行内显示来源（`sourceStatus` · `caseId`）与时间；Conflicts 只渲染当前 pack 的 `contradicts`，每行为「左标题 ↔ 右标题」+ 两个 cardId + 「待核对」徽章，标题从 `pack.hits` 解析。导入身份占用不进 Conflicts。Cards 列表为空时把「导入知识」放在列表内容起始区，不只留在左下；该空态文案不属于 Candidates。
3. **Detail**：`h1` 标题 + 元信息行（徽章 · 更新于 · 空间；候选视图追加「待审核」与来源）、右侧「卡片信息」开关、卡片 `images[]` 预览（`knowledge:image`；缺失标「对照图未入库」）、`KnowledgeMarkdown` 正文、写操作。「卡片信息」展开为两列：类型 / 生命周期 / 来源状态 / 案例 ID / 更新时间 / 存储空间 / 相对路径，右列为范围（含排除）与关系（关系目标可点开）；底部「Provenance / Hash」默认折叠，仅当卡片带 `sourceHash` / `sourceMtimeMs` / `sourceSize`（由 `knowledge:card` 追加投影）时显示来源哈希 / 修改时间 / 大小，否则说明「没有导入来源记录」。空态说明「导入后可在此阅读知识卡片」。`sourceStatus === 'fixed'` 永远带 “≠ verified”。候选视图的主操作文案为「保存为草稿」（仍走 `persist-draft` 确认）。任一写操作只打开写入确认弹窗，不直接落盘。
   - **Conflicts 详情**：选中一对 `contradicts` 后，右栏显示「卡片 A / 卡片 B」并排对比（来源 · 标题 · 内容 · 更新时间），两卡通过现有 `knowledge:card` 按 `pack.hits` 解析加载；「查看相关卡片」跳回 Cards 视图打开该卡。核对是人工动作，没有自动裁决。

导入、导出与写入确认都是 `TaskDialog`（见 `docs/ui/design-system.md`「任务子弹窗」），叠在三列之上：背景空间、筛选、选择与滚动位置保留，关闭后恢复原阅读状态；Escape 只作用最上层。导入的文件 / 粘贴 / 结果是同一个弹窗内的状态，不逐层叠窗：文件模式分开显示文件名与完整路径并标「待校验」；粘贴模式字段为「知识内容 (YAML)」，有内容即出现「待校验」提示；结果态每条显示标题 + `caseId` + 真实状态句（写入空间草稿 / 已在该空间 / 隔离未写 / 目标空间已有此卡片），禁止写死 Processing details。导入成功后切 Cards、刷新 overview/query，并选中第一条写入的卡。写入确认的差异块带「− 变更前 (n) / + 变更后 (n)」图例。

窄屏 `≤960px` 只渲染一列，顶部三段 Spaces / List / Detail 与常驻关闭；选中卡片进入 Detail，Detail 提供返回。`≤640px` 任务子弹窗全屏。

## 产品边界

- 持久写入只能经 `KnowledgeWriteService.write/promote`，且 `confirmation.explicitHumanConfirmation === true`；`FullAccess` 不得绕过。
- Candidate 只能经 `createCandidate({ explicitUserIntent: true })`，必须由用户点击触发。
- 导入只走 `KnowledgeImportService.importToSpace`：解析通过的条目经 `WriteService` 原子写入所选 user/project 空间，`lifecycle: draft`，`verified: false`，**不得**导入即 Candidate，也不得批量提升。会话不是知识库；`knowledge-state.json` 只存 Candidate/review。用户文案统一「导入知识 / 导出知识」。选文件只走 `dialog:selectKnowledgeImport`（zip / yaml / yml），禁止 All Files、禁止单独选 png。知识包 zip 的包根是解压根；本机案例 YAML 的包根是该文件所在目录。卡片可声明 `images[]`，图一律按「包根 + 声明相对路径」入库；缺失则标「对照图未入库」。粘贴 YAML 不含对照图。隔离（secret / 绝对路径 / 坏 YAML）不写盘。同源 `sourceHash` 已在目标空间 → 幂等「已在该空间」，不覆盖。不同源同 ID → 导入冲突，条目带标题 / `caseId` / 已有 `cardId`，文案是「目标空间已有此卡片」，**禁止**写成 Conflicts 页的 `contradicts`。导入结果是 `items[]`（每项自带 status / record / missingAssets / reason / existingCardId）。
- 导出经 `KnowledgeExportService`，格式二选一：**知识包**（标准 zip 载体，内含 `knowledge.yaml` 的 `rdc.knowledge-package/1` 与声明对照图，可再导入）与 **Markdown**（阅读用途，不可再导入，不夹图）。范围为当前选中卡片 / 当前筛选结果 / 指定空间；`filtered`/`selected` 用当前列表，`space` 计数必须问该 `spaceId` 的 `listCards`/`query`，不得用当前 Cards `hits.filter`。导出包剔除 `sourceHash` / `sourceMtimeMs` / `sourceSize` 与任何绝对路径，复用导入同一套 secret 扫描；磁盘上不存在的图不写入 yaml 的 `images[]`；绝不导出凭据、provider 配置或会话数据。导出包的 `lifecycle` 只是元数据，再导入一律落目标空间 draft（`verified: false`）。保存位置由系统保存对话框选定（知识包扩展名为 zip），取消不产生半成品。
- 禁止声称语义检索。Semantic lane 开关与 Settings > Models Embedding 重建入口已删除。
- Center 的 Rebuild Index 只重建 `KnowledgeIndexService` 结构索引。
- `change reason` 与 `rollback basis` 只做确认门禁，不落盘。
- 不做 Repo Wiki、Memory 页签、自动生成、重新生成或有用/无用反馈。

## 实现锚点

| 层 | 路径 |
|----|------|
| 入口 | `src/renderer/app/WorkbenchShell.tsx`（`sidebar-knowledge-center-trigger`） |
| 模态 | `src/renderer/features/knowledge/KnowledgeCenterModal/` |
| 主进程 | `src/main/knowledge/` 五服务 + `KnowledgeImportService` + `KnowledgeExportService`；IPC `src/main/ipc/knowledgeHandlers.ts` |
| Renderer API | `src/shared/renderer-api/core.ts`（Desktop / Browser 共用） |
| 类型 | `src/shared/types/knowledge.ts`、`src/shared/types/knowledgeExport.ts` |

IPC 通道：`knowledge:overview` / `query` / `card` / `compile` / `index:rebuild` / `candidates` / `candidateCreate` / `import` / `image` / `issueApprovalToken` / `write` / `promote` / `export`。写/提升必须消费 Main 签发的 `approvalToken`，并带 `explicitHumanConfirmation`；`knowledge:export` 为 `high-impact`，目标路径由 `dialog:saveFile` 的系统保存对话框返回（知识包扩展名 zip），renderer 不得自行拼绝对路径。知识导入选文件走 `dialog:selectKnowledgeImport`（zip / yaml / yml），不走 `dialog:selectFiles`。已删除 browse-only 的 `knowledge:listSpaces` / `listCards` / `getCard`。

权威产品边界见根目录 `DESIGN.md`「Knowledge」。
