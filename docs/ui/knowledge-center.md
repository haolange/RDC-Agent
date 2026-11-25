# Knowledge Center

知识中心是 Workbench 左侧边栏底部、用户条上方的常驻入口，打开居中实色分层模态（在 `88vw × 86vh`、硬顶 `120rem × 70rem` 内接最大 16:10，backdrop `--modal-workbench-inset`；`≤960px` 时三列切换，`≤640px` 全屏）。它消费 `Query` / `Index` / `Compile` / `Candidate` / `Write` 五个核心服务，以及 `Topic`（主题与同义词）、`Import` / `Export`；渐进读取（`Read`）只给 Agent 的知识工具，不另开 browse 双轨或派生存储。

## 信息架构

三列网格：`14rem minmax(17.5rem, 0.65fr) minmax(0, 1.35fr)`；中列可换行。

顶部标题栏是两个一等入口：「导入知识」（`ui/Button` primary）与「导出知识」（secondary），把知识带进来、带出去是人来这里的两件主事；偶尔才做的「主题与同义词」「重建索引」在「⋯」里，均打开任务子弹窗。

1. **Spaces / 控制列**：Cards / Candidates / Conflicts 三项导航（`ui/ListRow` 选中指示条；候选与冲突的计数只在大于 0 时出现，卡片数取索引 `cardCount`）、User + 已注册 Project 多选（只有多于一个空间且有卡片时才显示，行尾为该空间卡片数）。没有「索引维护」面板：索引随卡片变化自己更新（查询与 overview 都读取 `getOrRebuild` 的当前索引），正常时什么都不显示；只有索引建不起来（overview 的 `index` 为空）时，列表顶部才出一行提示与「重建」按钮。「⋯」里的「重建索引」是任务子弹窗：一句说明、卡片数与上次构建时间、重建按钮；revision 不上界面。检索通道不是筛选维度，界面不再出现。Semantic lane 与 Settings Embedding 重建入口已删除。
2. **List**：Cards 视图有搜索框（300ms debounce）驱动 `knowledge:query`；类型 / 生命周期收进「筛选」`Popover`，以 `CheckPill` 表达多选；检索通道是实现细节，不是筛选维度。Cards 行自上而下为：标题（最多两行，类型用标题前的小图标表示）、一行预览、状态徽章（`ui/Badge`，只给非草稿状态：候选为 warning，已验证为 success，已提升为 accent，退役为中性；草稿是默认态，不贴徽章）。预览来自索引 `preview`，与标题相同则不显示；顺序按服务返回的 `hits`，渲染层不得重排。结果超过一页时列表底部显示「加载更多」：每页 50 条，以上一页的 `nextOffset` 与 `expectedRevision` 续取。Candidates / Conflicts 视图把搜索与筛选换成列表头（标题 + 计数 + 一句说明）：Candidates 只列 `listCandidates`，列表头说明审核任务，每行显示候选卡的标题与预览。Conflicts 只渲染当前 pack 的 `contradicts`，列表头说明人工核对，每行显示成对标题与最近更新时间。两端标题从 `pack.hits` 解析，未载入的标题以对应一端的卡片标签标明。导入身份占用不进 Conflicts。Cards 列表为空时把「导入知识」放在列表内容起始区，不只留在左下；该空态文案不属于 Candidates。
3. **Detail**：`h1` 标题，标题下一行事实（类型 · 平台 · API · GPU · 引擎，取自 scope，值为 unknown 的轴不写）加一个状态标签（人话写成「已修复 · 未验证」这类组合，悬停解释修复与验证的区别；修复不等于验证的完整性要求照样满足）、标题旁「信息」开关、排好版的全文、底部动作。「信息」展开为两列：类型 / 主题 / 生命周期 / 更新时间 / 存储空间，右列为范围（含排除）与关系（当前结果可定位的卡片按标题打开，缺少目标时就地说明）；cardId、caseId、来源状态码与来源哈希 / 修改时间 / 大小（`knowledge:card` 追加投影的 `sourceHash` / `sourceMtimeMs` / `sourceSize`）不上界面，经卡片底部「⋯ › 复制诊断信息」进剪贴板，与该卡的其他动作共用菜单。未选中卡片时详情为页级空态；只有卡片列表为空时才补一句「导入后可在此阅读知识卡片」。底部按生命周期只给一个主动作（草稿 → 提交为候选；待审核的候选 → 保存为草稿；已存的候选 → 通过验证；已验证 → 提升；已提升与已退役 → 保存），其余可行动作收进「⋯」，不会改变卡片的动作不出现；提交为候选不可用时原因在按钮的悬停里。任一写操作只打开写入确认弹窗，不直接落盘。
   - **全文阅读**：选中卡片即经 `knowledge:card` 读取整张卡片，并核对它仍是搜索命中时的版本（`contentHash` 变了就提示重新搜索）；其他卡渲染 Markdown 正文（开头重复卡片标题的 `#` 标题不再画一遍）。案例卡沿详情栏的正文边缘排版，长段文字独立限行宽。案例卡读起来是一篇写好的报告：主张与标题不同才作为导语放在标题下；修复前 / 修复后对照图是主视觉（宽详情栏等宽并排，图片按原比例适应视口高度，图框与题注基线对齐。窄栏纵向排列。加载时显示骨架，确认缺图后显示「对照图未入库」，点击打开 `ui/ImageViewer`）；然后按「现象 → 证据 → 根因 → 修复 → 验证 → 关键标识 → 反例 / 未决挑战 → 适用范围」排章节，多章案例用下划线 Tabs 切换正文。选中新案例时打开首个有内容的章节。单章直接显示，空章省略。章节多是工具或人写的 JSON，每类按自己的形态排版（`parts/CaseChapterContent.tsx`，值的规则在 `knowledgeCaseValues.ts`）：现象是「期望 / 实际」左右对照，其余视觉事实（现象、空间与时间特征、受影响对象）成一组事实行；证据每条一句结论，类型写成人话，证据编号不显示，来源工具与参数一次点击展开；根因以机制句开头，再列分类（点分路径写成「A › B」）、出错位置与违反的约束；验证是编号步骤；适用范围用本地化的轴名，unknown 写「未知」。不认识的键通用地转成人话标签，`snake_case` 枚举转成词；`asset-…`、`session://` 这类内部引用不上界面；SPIR-V 编号、`I-XXX-01` 这类工程师会搜索的标识与引擎对象名按行内代码显示。普通 Markdown 卡使用文档目录定位标题。界面不提供简介 / 章节 / 行范围切换，也不显示当前范围与总行数；写入直接从读到的这个版本出发。渐进读取（简介、章节、行范围）是 Agent 的知识工具能力（`projectKnowledgeRead`），没有对应的界面 IPC。
   - **Conflicts 详情**：选中一对 `contradicts` 后，右栏显示「卡片 A / 卡片 B」并排对比（来源 · 标题 · 内容 · 更新时间），两卡通过现有 `knowledge:card` 按 `pack.hits` 解析加载；「查看相关卡片」跳回 Cards 视图打开该卡。核对是人工动作，没有自动裁决。

「主题与同义词」是 `TaskDialog`：由 `knowledge:topics:suggest` 根据用户空间原文给出主题建议，用户勾选要分类的卡片并编辑同义词、合并目标或新增主题，先经 `knowledge:topics:preview` 显示完整预览（受影响卡片与差异，原始 Markdown 不改写），确认后才由 `knowledge:topics:apply` 应用；预览页以主题和卡片名称分组，分别展示同义词、合并目标与变更前后的分类，可返回修改。写入确认内的冲突以静态卡片标题成对展示，冲突列表则提供进入对照页的行操作。

导入、导出、写入确认与上述主题弹窗都是 `TaskDialog`（见 `docs/ui/design-system.md`「任务子弹窗」），叠在三列之上：背景空间、筛选、选择与滚动位置保留，关闭后恢复原阅读状态；Escape 只作用最上层。

导入是同一个弹窗里的三个时刻，不逐层叠窗：
- **选来源**：一句说明；多于一个空间时选目标空间；「文件 / 粘贴」分段控件。文件模式是一块放置区：把知识包拖进来（经 preload 的 `getPathForFile` 取路径，取不到就提示改用「选择文件」），或点「选择文件」；选定即自动预览。粘贴模式是「知识内容 (YAML)」输入框，点「预览」。
- **预览**：`knowledge:previewImport` 读同一来源，按导入的同一判定逐条给出结果而不写盘：首行「将导入 N 张新卡片」，次行列出已存在 / 冲突 / 隔离的数量；每条是类型图标、标题、类型 · 图片数、状态徽章（新增 / 已存在 / 冲突 / 隔离），冲突写「空间里已有同一案例的另一版本，不会改写它」，隔离写人话原因（绝对路径、密钥、坏格式、无效知识包……）。主按钮「导入 N 张」，没有新卡时不可点；「返回」回到选来源。
- **结果**：确认后主进程弹出原生确认，再写入；结果页「已导入 N 张卡片」与同样的逐条列表（已写入草稿 / 已存在 / 未写入），新写入的草稿可直接「创建候选」。界面不显示 caseId、相对路径、已有卡片 id 与原因码。导入成功后切 Cards、刷新 overview/query，并选中第一条写入的卡。

导出弹窗：范围为「选择卡片」（列表已载入的卡片，可按标题筛选、全选 / 清空，显示已选数量；打开时默认勾选当前卡片）/ 当前筛选结果 / 整个空间，格式为知识包或 Markdown；完成后写已导出的条数与文件名。写入确认的差异块带「− 变更前 (n) / + 变更后 (n)」图例；写入目标、回滚哈希与大小通过确认弹窗标题栏「⋯ › 复制诊断信息」取得。

**预览规则**：主进程在建索引与导入时生成 `preview`，只取可读正文——Markdown 卡跳过与标题重复的段落和 JSON 段落；案例 YAML 取结构化字段 `symptoms`，没有则取 `fix`，都没有则回退标题。序列化时 `preview` 与标题相同则不写。渲染层不得自行截取或拼接正文作为预览。

窄屏 `≤960px` 只渲染一列，顶部三段 Spaces / List / Detail 与常驻关闭；选中卡片进入 Detail，Detail 提供返回。任务子弹窗按内容设宽高上限，正文单独滚动，底部操作按需换行。

## 产品边界

- 持久写入只能经 `KnowledgeWriteService.write/promote`，且 `confirmation.explicitHumanConfirmation === true`；`FullAccess` 不得绕过。
- 写入与晋升的审批 token 由主进程在原生确认后签发，绑定空间、路径和卡片序列化字节的 SHA-256；`knowledge:write` / `knowledge:promote` 只在 IPC 边界消费一次，换了卡片内容或重复使用都会被拒（`KNOWLEDGE_APPROVAL_TOKEN_INVALID`）。
- 文件夹知识包只读取包目录内的普通文件：资产名为 `..`、绝对路径或链接（文件或途经目录）时整次导入失败（`KNOWLEDGE_ASSET_PATH_INVALID` / `KNOWLEDGE_ASSET_LINK_REJECTED`）；图片内容须与扩展名声明的格式一致（`KNOWLEDGE_IMAGE_INVALID`）。zip 在解压前按条目声明的原始大小累计限额（32MiB），超限直接拒绝。
- 导入与导出共用 `knowledgeSensitiveText` 的密钥判定：按值的形状识别（`sk-`、`ghp_`、`AKIA`、PEM 私钥、JWT、Bearer、带密码的 URI、`key: 值` 赋值），只出现 "password" 这类词的正文不算密钥。
- Candidate 只能经 `createCandidate({ explicitUserIntent: true })`，必须由用户点击触发。
- 导入只走 `KnowledgeImportService.importToSpace`，预览走同一服务的 `previewImport`，两者共用 `planKnowledgeImport` 这一处判定（隔离 / 已在空间 / 冲突 / 新增），预览不写盘、不弹确认：解析通过的条目经 `WriteService` 原子写入所选 user/project 空间，`lifecycle: draft`，`verified: false`，**不得**导入即 Candidate，也不得批量提升。会话不是知识库；`knowledge-state.json` 只存 Candidate/review。用户文案统一「导入知识 / 导出知识」。选文件只走 `dialog:selectKnowledgeImport`（zip / yaml / yml），禁止 All Files、禁止单独选 png。知识包 zip 的包根是解压根；本机案例 YAML 的包根是该文件所在目录。卡片可声明 `images[]`，图一律按「包根 + 声明相对路径」入库；缺失则标「对照图未入库」。粘贴 YAML 不含对照图。隔离（secret / 绝对路径 / 坏 YAML）不写盘。同源 `sourceHash` 已在目标空间 → 幂等「已在该空间」，不覆盖。不同源同 ID → 导入冲突，条目带标题 / `caseId` / 已有 `cardId`，文案是「目标空间已有此卡片」，**禁止**写成 Conflicts 页的 `contradicts`。导入结果是 `items[]`（每项自带 status / record / missingAssets / reason / existingCardId）。
- 导出经 `KnowledgeExportService`，格式二选一：**知识包**（标准 zip 载体，内含 `knowledge.yaml` 的 `rdc.knowledge-package/1` 与声明对照图，可再导入）与 **Markdown**（阅读用途，不可再导入，不夹图）。范围为选择的卡片 / 当前筛选结果 / 指定空间；`filtered`/`selected` 用当前列表（`selected` 是选卡清单里勾选的卡片，经 `cardRefs` 传给主进程），`space` 计数必须问该 `spaceId` 的 `listCards`/`query`，不得用当前 Cards `hits.filter`。导出包剔除 `sourceHash` / `sourceMtimeMs` / `sourceSize` 与任何绝对路径，复用导入同一套 secret 扫描；磁盘上不存在的图不写入 yaml 的 `images[]`；绝不导出凭据、provider 配置或会话数据。导出包的 `lifecycle` 只是元数据，再导入一律落目标空间 draft（`verified: false`）。保存位置由系统保存对话框选定（知识包扩展名为 zip），取消不产生半成品。
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

IPC 通道：`knowledge:overview` / `knowledge:topics:suggest` / `knowledge:topics:preview` / `knowledge:topics:apply` / `query` / `card` / `compile` / `index:rebuild` / `candidates` / `candidateCreate` / `previewImport` / `import` / `image` / `issueApprovalToken` / `write` / `promote` / `export`。写/提升必须消费 Main 签发的 `approvalToken`，并带 `explicitHumanConfirmation`；`knowledge:previewImport` 读取 renderer 指定的文件，在 Browser QA 能力表里与导入同为 `high-impact`；`knowledge:export` 为 `high-impact`，由主进程在同一次调用里弹系统保存对话框并写出（知识包扩展名 zip，Markdown 为 md），renderer 不传目标路径；用户取消对话框时返回 `null`，导出面板保持原样。知识导入选文件走 `dialog:selectKnowledgeImport`（zip / yaml / yml），不走 `dialog:selectFiles`。已删除 browse-only 的 `knowledge:listSpaces` / `listCards` / `getCard`。

权威产品边界见根目录 `ARCHITECTURE.md`「G. Knowledge」。
