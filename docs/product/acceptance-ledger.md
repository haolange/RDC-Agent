# Acceptance Ledger

Verifier 结论落盘。本文件是二次收敛（U00–U07）与 T18 现场取证的验收台账，不是第二产品权威；产品裁决以根目录 [`DESIGN.md`](../../DESIGN.md) 为准。

**Browser 证据路径在仓库外** `%LOCALAPPDATA%/rdc-agent-qa/<sha>/`。条目若引用 Browser 证据，只记相对该目录的路径、build SHA、QA `projectId` / `sessionId`、viewport、theme/motion、DOM selector、IPC channel + 结果码。**禁止**写入 token / cookie / secret / qaBootstrap。

`pnpm run check:acceptance-ledger` 已由 **U04** 落地并接入 CI / `check:gates`。历史状态按下表记录；U06-t17-completed 的真实实验结论已于 2026-09-09 撤回，见该行纠正。

Verdict 枚举：`planned` / `verified` / `failed` / `waived-by-user`。`verified` 行的 Commit SHA（短或长）必须存在于 `git rev-list HEAD`；空 / `—` 只允许非 verified。不得伪造。

| Task | Criterion | Gate/Test | Browser evidence ref | Verdict | Commit SHA | Date |
| --- | --- | --- | --- | --- | --- | --- |
| PLAN-GATE-L1 | Mission `plan_artifact` 覆盖活计划、拒绝修订同一份、批准冻结并只放行同 hash / 同 target / 同冻结 URI 的 execute | `AgentPlanReviewRequestService` / `PlanReviewStateStore` / `PlanArtifactWriter` / `HandoffController` / `ToolExecutorFactory` / `HandoffProviderFixture` | — | planned | — | 2026-09-14 |
| PLAN-GATE-UI | transcript 计划卡 + 只读面板 + Composer 待审门 + 回合结束 handoff 建议行；优先级 toolApproval > planReview > userInput | `planReviewRequestModel` / `workProcessPresentation` / `check:work-process-tool-coverage` / `check:design-tokens` | disposable `qa-1789374688563-6681812f93040d61`（已清理）；project `proj_85e9bdb7e163`；session `sess_459d84ad54cf`；同源 `/app`；卡 `plan-card is-awaiting`；面板 `role=dialog` + Esc 回卡；Composer `拒绝意见` 空则拒绝禁用；建议行 `Execute with General` 将 `agentId` 切到 `general`；`plan:saveToProject` 写入 `.rdx/plans/<sessionId>/plan.md` 且 `.gitignore` 不含 `plans/`；窄屏 390 侧栏收起后卡/门/面板仍可用。无 token | planned | — | 2026-09-14 |
| PLAN-GATE-QA | Browser QA：Mission → plan_artifact → 拒绝 → 修订 → 批准 → agent_handoff；卡 / 面板 / Composer 门 / 建议行 / 窄屏 390 / Esc | disposable `start:agent-browser`；`HandoffProviderFixture` 为确定性工程验证，不是活模型证据。Browser 无运行期 fixture provider，未用真实 userData 重跑模型选工具 | 同源 `/app` 投影 UI 已过（见 PLAN-GATE-UI）。`conversation:answerPlanReview` 在无活 pending 时 fail-closed：`No pending plan review request was found for this turn.` 前轮未重跑活链路；2026-09-14 本轮已真实完成审阅、拒绝修订和批准冻结，完整模型交接因 8 请求预算耗尽仍未通过，见文末本轮证据。无 token | planned | — | 2026-09-14 |
| UI-composer-focus | 通过原生项目入口进入真实 Composer，复查鼠标／键盘聚焦白框、编辑／预览、附件与 Skill 操作 | Tabs 多实例 ID、禁用和键盘导航单测已过；真实 Composer 待验证 | — | planned | — | 2026-09-12 |
| UI-knowledge-data | 补齐 K01/K04/K05/K06/K09/K10/K11 实际阅读、元数据、候选、冲突、导入结果、导出与写入确认 | 迟到详情请求回归已过；空态不替代有数据状态 | — | planned | — | 2026-09-12 |
| UI-project-model | 补齐 T03 Project MCP 信任、T01 有数据表格、A06 已配置模型选择 | 当前仅无配置／空表状态，不证明真实连接 | — | planned | — | 2026-09-12 |
| UI-provider-auth | 对设备授权、浏览器授权及环境凭据取得实际成功／失败／取消证据 | 初始弹窗及本地 Ollama 请求失败已观察；外部成功态未验证 | — | planned | — | 2026-09-12 |
| UI-matrix | 补齐 Dark/Light、中英文、1440/1024/640 的受影响状态，修改后重截并由用户审阅 49 面板 | 已观察中文 Dark 1440、英文 Light 640 顶层；中间宽度实测 1023，非精确 1024 | — | planned | — | 2026-09-12 |
| UI-knowledge-relations | 独立核对 K06 ingest 关系传递及实际冲突数据来源 | 既有关系处理问题；不混入组件重构，不宣称已修复 | — | planned | — | 2026-09-12 |
| UI-browser-arguments | 独立收敛 Browser 调用中间可选参数 undefined 序列化为 null 的问题 | 保持严格 IPC 校验；不以放宽 null 接受绕过 | — | planned | — | 2026-09-12 |
| UI-sidebar-seam-resize | Docked 左右栏可见接缝可拖；drawer / 收起不挂载 handle，无溢出命中 | `ResizeHandle.test.ts`；`layoutGeometry.test.ts`；`check:design-tokens`；`check:renderer-structure`；disposable `start:agent-browser:dev` | disposable `qa-1789278812686-0ae538035f75a7a0`；project `proj_d40bc2a0d9ea`；1440 左缝 `col-resize` 且 `::before` left `-8px`，宽 420→380；右缝 `::before` right `-8px`，宽 312→360；700 `has-left-drawer` 且左右 handle 均未挂载、grid `0 0 700 0 0`。无 token | verified | 99f2dd04 | 2026-09-13 |
| UI-rail-gutter-restore | Project / Session 右栏四边走廊与 Session 卡间距同为 `--space-3`；Project 单卡 `gap: 0`；接缝可见描边不侵入卡片，透明 hit 仍可拖 | `ResizeHandle.test.ts`；`check:right-rail`；`check:design-tokens`；`check:renderer-structure`；`typecheck`；`lint`；disposable `start:agent-browser:dev` | disposable `qa-1789280650711-1d6a0ef2c66a53e3`；project `proj_e1089fbd825a`；session `sess_a49b80e253ae`；1440 Project 单卡 padding 12 四边、`gap: 0`、走廊 L/R/T 12；1440 Session 五卡 padding/gap 12、卡间 12×4、左右 `::before` content none、hit 探出 8px、右缝 312→327；700 抽屉无 handle、grid `0 0 700 0 0`、栏壳 padding/gap 仍 12。无 token | verified | 475e29f8 | 2026-09-13 |
| U00-topology | DESIGN / AGENTS / docs 跨文档拓扑一致：四 builtin 唯一；ask/plan/edit 非法 id + 无 custom manifest 运行通道 | 人工对照 `DESIGN.md` 裁决 A；U04 `check:acceptance-ledger` 短语断言 | — | verified | fbf5d639 | 2026-09-05 |
| U00-six-lanes | Knowledge 目标拓扑为六 lane（Identity/Path、Scope/Metadata、Lexical、Structural、Relation/Graph、Temporal/Version）；Embedding / Semantic 不是现行合同 | 人工对照 `DESIGN.md` 裁决 C / G | — | verified | fbf5d639 | 2026-09-05 |
| U00-read-roots | canonical knowledge 读根合同已写入：`realpath(~/.rdx/knowledge)` + `realpath(<projectRoot>/.rdx/knowledge)` 仅对 `read_file`/`read_image`/`glob`/`grep` 免审批；write/edit/delete/shell/code_interpreter 双层拒绝。U02 改代码 | `docs/contracts/permissions.md`；`DESIGN.md` 裁决 G | — | verified | fbf5d639 | 2026-09-05 |
| U00-run-v3 | 文档现行合同为 Run schema v3；禁止再写「Run 当前仍为 v2」 | `DESIGN.md` 裁决 I；`docs/product/renderdoc-agent-complete-design.md` §3.7 / §22 | — | verified | fbf5d639 | 2026-09-05 |
| U00-investigation-read | IPC `investigation:read({ sessionId, artifactId, expectedHash })` 已落地；投影带完整 `contentHash`；禁止再写「无该 IPC」 | `DESIGN.md` 裁决 B / E；`docs/contracts/permissions.md` | — | verified | fbf5d639 | 2026-09-05 |
| U00-no-custom-manifest | 文档删除「用户保留的已改 ask/plan/edit 仍可按 custom manifest 运行」作为现行合同；目标态无运行通道（U01 改代码） | `DESIGN.md` 裁决 A；`docs/product/agent-manifest-models.md` | — | verified | fbf5d639 | 2026-09-05 |
| U00-ledger | 本文件已建；列正好为 Task / Criterion / Gate/Test / Browser evidence ref / Verdict / Commit SHA / Date | 本文件存在；U04 才接 `check:acceptance-ledger` | — | verified | fbf5d639 | 2026-09-05 |
| U00-hygiene | `pnpm run check:repository-hygiene` 绿 | `pnpm run check:repository-hygiene` | — | verified | fbf5d639 | 2026-09-05 |
| U01-canonical-hash | `hashCanonicalAgentSemantics` 只排除顶层 `models`/`icon`/`accent` 与 `handoffs[*].model` | U01 字段级测试；`check:settings-agents` | — | verified | 7fdd56f1 | 2026-09-05 |
| U01-v2-marker | seed 迁移 marker `schemaVersion:'2'`；v1 视为未完成并重跑；更高版本 fail-closed | U01 purge/keep 矩阵 | — | verified | 7fdd56f1 | 2026-09-05 |
| U01-crash-recovery | 隔离前写 isolation manifest；未完成事务可恢复或 fail-closed，不静默丢文件 | U01 崩溃恢复测试 | — | verified | 7fdd56f1 | 2026-09-05 |
| U01-purge-keep | 历史 id `purged-historical`；shadow `purged-shadow`；改过正文/工具的 builtin-id `retained-override`；无关 id `retained-custom` | U01 purge/keep 矩阵 | — | verified | 7fdd56f1 | 2026-09-05 |
| U01-illegal-id | user/project 非法 id 剔出 effective snapshot + `AGENT_ID_RESERVED_HISTORICAL`；无 custom manifest 运行通道 | `check:settings-agents` | build `7fdd56f1`；QA project `proj_a99a24c68de3`；canonical；1440 desktop；Settings Agents 列表恰 4（Analyzer/Debugger/General/Optimizer）；Composer Agent 菜单恰 4 menuitemradio；`[data-testid=settings-agent-manifest-diagnostics]` 不存在；`~/.rdx/agents` 仅 v2 marker，actions 6 条（3 historical + 3 shadow）；截图 `%LOCALAPPDATA%/rdc-agent-qa/7fdd56f1/u01-settings-agents-four.png` | verified | 7fdd56f1 | 2026-09-05 |
| U02-delete-embedding | 逐文件删除 EmbeddingCatalog / EmbeddingExecutionService / Semantic lane / `settings.llm.embedding`；禁止恢复 | U02 `check:knowledge-system` `forbidden.embedding-runtime`；`check:provider-catalog` | build `3bff8172`；canonical；Settings 搜索 “Embedding” 无命中；截图 `u02-settings-search-embedding.png` | verified | 3bff8172 | 2026-09-05 |
| U02-six-lanes-code | Knowledge 源码与门禁收敛为六 lane；不再把 Semantic hits 当现行门禁 | U02 `check:knowledge-system` `lanes.six` | build `3bff8172`；QA `proj_a99a24c68de3`；1440 desktop Dark；Knowledge Center LANES 恰 6（Identity/Path、Scope/Metadata、Lexical、Structural、Relation/Graph、Temporal/Version）；Rebuild 文案 six retrieval lanes；无 Semantic；截图 `u02-knowledge-center-six-lanes.png` | verified | 3bff8172 | 2026-09-05 |
| U02-read-roots-code | `knowledgeReadRoots` 冻结并仅注入四只读文件工具；写工具双层拒绝 | U02 permissions / EffectiveRuntimePlan 测试 | build `3bff8172`；QA `proj_a99a24c68de3` / `sess_e2b23442e230`；Debugger + grok-4.6；`grep ~/.rdx/knowledge` 无审批命中 `AIRD-20260207-0001`（`cardId: user:cases/AIRD-20260207-0001.md`）；`glob/read_file ~/.rdx/memory/*` 审批 pending 后拒绝；Context 卡普通 file `AIRD-20260207-0001.md` + directory `knowledge`；IPC `conversation:answerToolApproval` deny `success:true`；截图 `u02-read-roots-context.png` | verified | 3bff8172 | 2026-09-05 |
| U02-settings-7 | Settings schema 6→7 一次性删除 `llm.embedding`；>7 fail-closed | U02 settings 迁移 fixture | build `3bff8172`；Settings 搜索 “Embedding” 无命中；Provider 页无 Embedding 区；截图 `u02-settings-search-embedding.png` | verified | 3bff8172 | 2026-09-05 |
| U03-mcp-legacy | `MCPManager` name-segment 仅保留 encode/decode fail-closed；无 legacy sanitized 兼容读路径 | `MCPManager.test.ts`；`check:legacy-residue` | — | verified | 60ed27dc | 2026-09-05 |
| U03-modes | `MODE_CAPABILITIES` 已删除；保留 `assignDefaultCaptureRoles` | `modes.test.ts`；`check:legacy-residue` | — | verified | 60ed27dc | 2026-09-05 |
| U03-dead-types | 删除 dead `WriteScope` / `IntakeContext` / `GateResult` | `check:legacy-residue`；`check:shared-exports` | — | verified | 60ed27dc | 2026-09-05 |
| U03-timeline-type | `AgentTimelineEntry.type` 收窄为 `user` / `agent` / `system` / `tool_call` | `src/shared/types/agent.timeline.test.ts`；`check:legacy-residue` | — | verified | 60ed27dc | 2026-09-05 |
| U03-coordination-mode | `coordinationMode` → `turn_handoff`（shared/main/renderer/测试同步） | `src/shared/types/workflow.test.ts`；`check:legacy-residue` | — | verified | 60ed27dc | 2026-09-05 |
| U03-plan-phases | `check-investigation-system` 改为 understand/work/summarize phase 合同 | `pnpm run check:investigation-system` | — | verified | 60ed27dc | 2026-09-05 |
| U03-rdx-leak | 删除 `rdx-runtime-leak.json` 写入；改 runtimeLog + `ProcessSupervisor unconfirmed_orphan` | `RdxSessionService.test.ts`；`check:legacy-residue` | — | verified | 60ed27dc | 2026-09-05 |
| U03-harness | `harness.ts` **不改名**，只确认只剩 `ArtifactKind` / `ArtifactRecord` | `check:legacy-residue` | — | verified | 60ed27dc | 2026-09-05 |
| U03-legacy-residue | `check:legacy-residue` 零命中（合法词精确上下文白名单）；已接入 `check:gates` | `pnpm run check:legacy-residue` | — | verified | 60ed27dc | 2026-09-05 |
| U04-gates | CI build job 改为 `pnpm run check:gates` 聚合 | `.github/workflows/ci.yml`；本地 `check:gates` | — | verified | 36fff8a4 | 2026-09-05 |
| U04-diff-check | CI 增加 `git diff --check`（有效 base 解析） | `scripts/check-git-diff.mjs`；`src/main/testing/gitDiffCheck.test.ts` | — | verified | 36fff8a4 | 2026-09-05 |
| U04-ledger-gate | `check:acceptance-ledger` schema + verified SHA ∈ `git rev-list HEAD`；文档 required/forbidden 短语断言 | `pnpm run check:acceptance-ledger` | — | verified | 36fff8a4 | 2026-09-05 |
| U05-browser-matrix | 产品级 Browser QA 汇总：1440×900 与 390×844；Light/Dark/reduced-motion；Workbench/Project/Session/Settings 九节/Knowledge/五卡/Composer 互斥/fail-closed/qaPerformance 探针。Memory 审批不在本行，见 U06 | `start:agent-browser` canonical FULL_ACCESS 1 然后 0；`check:acceptance-ledger` | build `85bb50ce`；project `proj_a99a24c68de3`；sessions `sess_3dd379b23f12` `sess_5e7563cc40a9`；canonical Dark `reduceMotion=off` 除非细行另写；证据 `%LOCALAPPDATA%/rdc-agent-qa/85bb50ce/`（12 PNG + `u05-invoke-results.json` + `u05-dom-observations.json`）；IPC 见该 JSON。细则 U05-* | verified | 85bb50ce | 2026-09-05 |
| U05-workbench-empty | Workbench 空态四 builtin：Debugger/Analyzer/Optimizer 卡 + Composer General；无 ask/plan/edit | Browser DOM + 截图 | build `85bb50ce`；project `proj_a99a24c68de3`；session `sess_3dd379b23f12`；1440×900 Dark motion=off；DOM `.empty-workbench` 三卡 + `[data-testid=composer-agent-pill]`/`button.composer-agent-pill` 名 General；无 menuitemradio Ask/Plan/Edit；IPC 无（纯渲染）；截图 `u05-workbench-empty-1440.png` | verified | 85bb50ce | 2026-09-05 |
| U05-settings-nine-search | Settings 九节 + 搜索跳转 + roving tabindex | Browser DOM | build `85bb50ce`；project `proj_a99a24c68de3`；session `sess_5e7563cc40a9`；1440×900 Dark motion=off；`[role=tab]` 恰 9；`[placeholder=Search settings]` 输入 compaction → `[role=listbox]` Compaction threshold Policy → Policy `aria-selected=true`、`[role=combobox]` value 80%；Policy `tabIndex=0` 其余 -1；Home→General End→Policy；IPC 无；截图 `u05-settings-nine-tabs.png` `u05-settings-search-policy.png` | verified | 85bb50ce | 2026-09-05 |
| U05-knowledge-center | Knowledge Center 三列 + 六 lane；无 Semantic | Browser DOM | build `85bb50ce`；project `proj_a99a24c68de3`；session `sess_3dd379b23f12`；1440×900 Dark motion=off；LANES 恰 6（Identity/Path、Scope/Metadata、Lexical、Structural、Relation/Graph、Temporal/Version）；列 Cards/Candidates/Conflicts；User space 2；正文无 Semantic；IPC 无（UI 打开）；截图 `u05-knowledge-center-six-lanes.png` | verified | 85bb50ce | 2026-09-05 |
| U05-five-cards | Session 五卡空态 + 中文长名 Capture | Browser `h2` + Capture 控件 | build `85bb50ce`；project `proj_a99a24c68de3`；session `sess_3dd379b23f12`；1440×900 Dark motion=off；`h2` 恰 Progress/Artifacts/Outputs/Context/Capture；Capture 文案含 `眼睛泪腺白点.rdc` 与 1.5 GB；按钮 Open；IPC 无；截图 `u05-session-five-cards-1440.png` `u05-capture-card-1440.png` | verified | 85bb50ce | 2026-09-05 |
| U05-composer-exclusive | 五底栏互斥 + Escape 回 trigger；1440 无重叠 | DOM `aria-expanded` 序列写入证据 JSON | build `85bb50ce`；project `proj_a99a24c68de3`；session `sess_3dd379b23f12`；1440×900 Dark motion=off；几何 overlapX=0（Default.right 685.8 / Model.left 716.1）；序列见 `u05-dom-observations.json` composerExclusive（afterAgent/afterPerm/afterModel 同时只开一个 menu；afterEsc 全 false；focusAfterEsc=`composer-model-pill`）；静态布局截图 `u05-session-five-cards-1440.png` | verified | 85bb50ce | 2026-09-05 |
| U05-model-picker | Model picker 搜索 + Use Agent configuration 常驻；覆盖后 pill 显示 grok-4.6 | Browser + `session:setModelOverride` | build `85bb50ce`；project `proj_a99a24c68de3`；session `sess_5e7563cc40a9`；1440×900 Dark motion=off；`u05-model-picker-1440.png` 是覆盖前菜单（底栏 Permission 文案 Default，不是模型名）；IPC `session:setModelOverride` `success:true`；覆盖后 pill 名 `grok-4.6` 见 `u05-effort-slider-qa-perf.png` 与 `u05-terminal-activity.png`；JSON `u05-invoke-results.json` `u05-dom-observations.json` | verified | 85bb50ce | 2026-09-05 |
| U05-session-isolation | 跨 session Composer 无串台 | Browser 点击 + `session.create` | build `85bb50ce`；project `proj_a99a24c68de3`；sessions B `sess_5e7563cc40a9` A `sess_3dd379b23f12`；1440×900 Dark motion=off；`session.create` `success:true`；草稿序列见 `u05-dom-observations.json` sessionIsolation（B=`U05-B-DRAFT-ISOLATION`，切 A 空串，切回 B 恢复）。create 后须 reload 才见 `.session-item-select` 列表；Light 截图同时列出两 session：`u05-light-reduced-motion.png` | verified | 85bb50ce | 2026-09-05 |
| U05-narrow-390 | 390×844 无水平溢出；底栏控件全在 viewport | CDP 几何 | build `85bb50ce`；project `proj_a99a24c68de3`；session `sess_5e7563cc40a9`；390×844 Dark motion=off；`.app-body` min-width `0px`；`documentElement.scrollWidth` 不大于 innerWidth+2；`.composer-agent-pill` `.composer-permission-pill` `.composer-model-pill` `.composer-effort-pill` `.composer-usage-indicator` `.chat-send-button` overflow=false；IPC 无；截图 `u05-narrow-390.png` | verified | 85bb50ce | 2026-09-05 |
| U05-light-motion | Light + reduceMotion=on reload 生效后恢复 Dark/off | `settings:set` / `settings:get` | build `85bb50ce`；project `proj_a99a24c68de3`；session `sess_5e7563cc40a9`；viewport 1440×900；`settings:set({appearance:{theme:light,reduceMotion:on}})` 后 `settings:get` theme=light reduceMotion=on；reload 后 `html[data-theme=light]` colorScheme=light bg=`rgb(244, 246, 249)`；截图 `u05-light-reduced-motion.png`；收尾 `settings:set` theme=dark reduceMotion=off，`settings:get` 确认；JSON `u05-invoke-results.json` | verified | 85bb50ce | 2026-09-05 |
| U05-fail-closed | FULL_ACCESS=1 仍拒 unknown/internal/secret/desktop-only | POST `/invoke` | build `85bb50ce`；project `proj_a99a24c68de3`；session `sess_5e7563cc40a9`；1440×900 Dark motion=off；channel→HTTP：`unknown:channel` 403、`internal:event` 403、`settings:getSecret` 403、`window:minimize` 403、`app:selectAvatar` 403、`settings:set` 500 schema（放行非 403）；记录 `u05-invoke-results.json`（无 UI 截图） | verified | 85bb50ce | 2026-09-05 |
| U05-full-access-0 | 未设 FULL_ACCESS 时 high-impact 403；读通道 200 | 第二轮 browser QA | build `85bb50ce`；project `proj_a99a24c68de3`；session 列表含上两 session；1440×900 Dark motion=off；`settings:set` 403、`command:execute` 403、`rdx-runtime:trustMcp` 403、`rdx-runtime:revokeMcp` 403、`rdx-runtime:trustHook` 403、`knowledge:write` 403、`session:list` 200、`unknown:channel` 403；记录 `u05-invoke-results.json` | verified | 85bb50ce | 2026-09-05 |
| U05-qa-performance | `?qaPerformance=1` 安装探针；默认 `/app` 不装 | `data-rdc-qa-performance` | build `85bb50ce`；project `proj_a99a24c68de3`；session `sess_5e7563cc40a9`；1440×900 Dark motion=off；URL `/app?qaPerformance=1` 时 `html[data-rdc-qa-performance-installed=true]` 且 attribute JSON `schemaVersion:2` `eventTimingSupported:true` `longTaskSupported:true` `interactionCount:0` `pointerToPaintP95Ms:null`（滑杆 role=slider pointer-events:none；Fast/Max switch disabled）；截图 `u05-effort-slider-qa-perf.png`；JSON 同目录 | verified | 85bb50ce | 2026-09-05 |
| U05-terminal-investigation | Terminal 空态；`investigation:read` 错误面 | DOM + IPC | build `85bb50ce`；project `proj_a99a24c68de3`；session `sess_5e7563cc40a9`；1440×900 Dark motion=off；`[data-testid=runtime-terminal]` 文案 `No activity is available for the current session yet.`；`investigation:read` 坏 hash → schema violation；`sessionId=sess_3dd379b23f12`（非当前）→ `errorCode=INVESTIGATION_SESSION_DENIED`；当前 session 缺失 id → `errorCode=INVESTIGATION_NOT_FOUND`；截图 `u05-terminal-activity.png`；JSON `u05-invoke-results.json` | verified | 85bb50ce | 2026-09-05 |
| U05-mcp-high-impact | 本轮无 MCP server；FULL_ACCESS=0 拒 trust/revoke。不宣称 Memory 审批已做 | `mcp.getStatusSummary` + `/invoke` | build `85bb50ce`；project `proj_a99a24c68de3`；session `sess_5e7563cc40a9`；1440×900 Dark motion=off；`mcp.getStatusSummary` 返回 `[]`；FULL_ACCESS=0：`rdx-runtime:trustMcp`/`revokeMcp`/`trustHook` 403。Tool approval 见已 verified 的 U02-read-roots-code（`conversation:answerToolApproval` deny `success:true`）。Memory 审批不在 U05 范围 | verified | 85bb50ce | 2026-09-05 |
| U06-t15-completed | T15 Debugger + WhiteHair（Android adb）正常 `completed`：checkpoint + ready report + `final_answer` 引用；负路径见已 verified 的 T18-t15-debugger-neg | 磁盘 `run.json` schemaVersion `'3'` + investigation index + luna 机器校验 | build `85bb50ce`；project `proj_a99a24c68de3`；session `sess_257be2c23d01`；run `run_2dad9f141f927f53` `kind:mission` `profileId:debugger` `status:completed`；device `android-e38b8019` serial `e38b8019` transport `adb_android` status `online`；checkpoint `cp-whitehair-eid167` `invart-6986d572b212-1788550160621`；ready report `invart-173a94986fc4-1788550214355` `sha256:3316c40ecc39baeed4a9c591fbcd539254f5cb4f908ec6317d4261b39b62cce5` `reportContract.status=complete`；final_answer 含 artifactId+hash；sourceRefs 8 条与 index hash 一致；Capture SHA256 不变 `03DF08D14E6D5819E5173209D9AC1218C2F740010104EC911A7873E97A258D42`；`workflow:listActiveRuns` `runs=[]`；1440×900 Dark motion=off；截图 `u06-t15-session.png`；JSON `u06-machine-check.json` | verified | 85bb50ce | 2026-09-05 |
| U06-t16-completed | T16 Analyzer + 中文 1.57GB capture：Observed/Reconstructed/Authoring 三层 claim + ready report complete；cancel 无迟到写入 | 磁盘 `run.json` + investigation + `conversation:cancelActiveTurn` | build `85bb50ce`；project `proj_a99a24c68de3`；session `sess_cff62330e3a7`；run `run_0f8e5559dec166c5` `kind:mission` `profileId:analyzer` `status:completed`；claims `cl-obs-capture-open`/`observed_fact`、`cl-der-active-event-147`/`derived_structure`、`cl-auth-filename-scene`/`semantic_inference`；checkpoint `cp-yanjing-v1` `invart-fb3119318569-1788552218039`；ready report `invart-e924efb74e67-1788553110003` `sha256:a38491c36d4079f987b1ec80e3df64a7dd715096f70203998d61cc8a530d8ce9` `reportContract.status=complete`；final_answer 含 artifactId+hash；sourceRefs 6 条一致；Capture SHA256 不变 `0A79926A92E7E659989BEFC2322DC93B65782252FC5BE2DE33496142735A4094`；`.right-rail` Capture 文案含 `眼睛泪腺白点.rdc` `1.5 GB`；`investigation:read` ok；cancel `conversation:cancelActiveTurn` success phase=`running` requestId `def4819a-5ae8-43d5-addb-5ad787c875f7` run `run_a17c5bdab038b000` cancelled；index hash 前后 `1A7E736B22B7B1489934D5106B4A308EF24F4FA6FF17BCCC24905A21083AACE1` lateWrites=0；1440×900 Dark motion=off；截图 `u06-t16-session.png` `u06-t16-capture-chinese.png`；JSON `u06-machine-check.json` | verified | 85bb50ce | 2026-09-05 |
| U06-t17-completed | T17 Optimizer：A-B-A Experiment `rolled_back` + rollback 三条件 + 工程 hash 前后一致 + ready report complete；Mission 侧 shell/write 被拒 | 磁盘 `run.json` + ExperimentRecord + 工程 manifest | build `85bb50ce`；project `proj_a99a24c68de3`；session `sess_db9dfe15578b`；run `run_85f6c28295a4e8b7` `kind:mission` `profileId:optimizer` `status:completed`；Android WhiteHair 当时 `Remote side of network connection is busy`，按计划改 Local 中文 capture；experiment `exp-opt-lacrimal-aba` `invart-exp-opt-lacrimal-aba` `status=rolled_back` `intervention.type=shader_replace` `rollback.executed=true` `baselineRestored=true` verifyEvidenceIds `ev-rollback-verify` `ev-shell-denied` `ev-write-denied`；未向 General handoff（Mission 侧 mutate 被拒，捕获未改）；checkpoint `cp-opt-lacrimal-v1`；ready report `invart-report-opt-lacrimal-ready` `sha256:11792293953c9ba73da74668a29baebd61f91596edab28f7499113bed1f426f6` `reportContract.status=complete`；final_answer 含 artifactId+hash；sourceRefs 8 条一致；工程目录 manifest SHA256 前后 `75444ef2b563eea2ac2df4fbb1f066fcf435e7435c6793a3eddf2ef33b4970f6`；`workflow:listActiveRuns` `runs=[]`；1440×900 Dark motion=off；截图 `u06-t17-session.png`；JSON `u06-machine-check.json` | failed | 85bb50ce | 2026-09-05 |

**2026-09-09 纠正 U06-t17-completed**：保留以上原日期、SHA、run、截图与 hash 供追溯；撤回“真实 A-B-A 已完成”的结论。原记录明确未向 General 交接、mutate 被拒，不能证明介入或回滚实际发生。权限拒绝与磁盘 hash 不变仅支持负路径；新的 verified 必须通过原生执行回执和恢复测量门禁。历史 verified 不自动代表当前版本验收。

| U07-release | 全量门禁 + coverage + build + pack；ledger 零 `planned`；交还 `instance.lock` | `check:gates` / `test:coverage` / `check:coverage-ratchet` / `build` / `pack` / `RDC_LEDGER_REQUIRE_ZERO_PLANNED=1` | coverage 2398/2398；ratchet lines 73.32 / functions 75.68 / branches 60.53 / statements 71.04；`electron-vite build` 绿；unpacked `release/win-unpacked` 无 pnpm/lockfile/launcher/cache；local pack 因 winCodeSign Darwin symlink 无管理员权限，用 `--config.win.signAndEditExecutable=false`（与「local pack stays unsigned」一致）；luna 首轮 MAJOR：两处「源码仍含 Semantic / Embedding，由 U02 删除」已在 `a31d6c00` 改成已删除；QA `instance.lock` owner pid 71808 已死。本行 SHA 为门禁/coverage/build/pack 落地提交 | verified | a31d6c00 | 2026-09-05 |
| T18-colddata-draft | ColdData → session Draft：`knowledge:coldDataImport` 两份桌面案例；`candidateCreated: false`；`sourceStatus: fixed`；`verified: false`；再导入 `conflict` | T18 canonical Browser QA | 仓库外 QA 记录；见 `DESIGN.md` T18 已证组 | verified | b68e4f29 | 2026-09-03 |
| T18-colddata-source | ColdData 源不变：`BugFull案例01.txt` SHA256 `b3885f07…c381d0`；`BugFull案例02.txt` `bfa12c54…7e35e5`；与 Draft `sourceHash` 一致 | T18 源 hash 复核 | 见 `DESIGN.md` T18 已证组 | verified | b68e4f29 | 2026-09-03 |
| T18-colddata-userspace | user-space 持久化：`~/.rdx/knowledge/cases/AIRD-20260207-000{1,2}.md`；index `cardCount: 2`；Center User space 2；中文标题完整；`knowledge:query` 词法命中「发黑」 | T18 Center + query | 见 `DESIGN.md` T18 已证组 | verified | b68e4f29 | 2026-09-03 |
| T18-chinese-capture-open | 中文 1.57GB capture open+preview：`眼睛泪腺白点.rdc` SHA256 `0A79926A92E7E659989BEFC2322DC93B65782252FC5BE2DE33496142735A4094`；size `1647684424`；`openProjectInput` `status: open`；`openHumanPreview` `success`；hash 2026-09-04 复测仍不变 | T18 Capture open/preview | 见 `DESIGN.md` T18 已证组 | verified | b68e4f29 | 2026-09-03 |
| T18-t15-debugger-neg | T15 Debugger 负路径：无 capture `sess_df6be27d58a5` → `MISSION_COMPLETION_DENIED`（缺 MissionCheckpoint），未伪装 completed。Settings RDX CLI 已配置；未配置 fail-closed 单测在 `adafa804` | `adafa804` 单测 + T18 session 证据摘要 | `sess_df6be27d58a5` | verified | adafa804 | 2026-09-03 |
| T18-t16-analyzer-blocked | T16 Analyzer Blocked 诚实收口：`sess_5be2b0c52a58` / `proj_a99a24c68de3`；ready report `invart-55a27b669134-1788459010567`（`sha256:3fc09696feae39145fd4c94c66c9260dda460f1da610e0d618789328aba4c5e3`）；`reportContract.status=Blocked` → `MISSION_COMPLETION_DENIED`；`cl_t16` 仍 draft；伴随 `a37c107e` | T16 文档取证 | `sess_5be2b0c52a58` | verified | 215741da | 2026-09-03 |
| T18-t17-optimizer-blocked | T17 Optimizer Blocked 诚实收口：`sess_a73c57d0d2a5` / `proj_a99a24c68de3`；ready report `invart-71244190ba45-1788459648111`（`sha256:335d77de70a9a196f150330f7ae703366dd240b6723c9714e57eb6bc4ab10bbd`，`reportContract.status=Blocked`）→ `MISSION_COMPLETION_DENIED`；未写 Experiment / 未 mutate 工程。无独立产品 commit；SHA 为首次写入 ledger 的记录提交 | T18 session 证据摘要 | `sess_a73c57d0d2a5` | verified | fbf5d639 | 2026-09-03 |
| T18-semantic | Semantic / 真实 OpenAI embed：Embedding / Semantic lane 已由 U02 删除，**不再补跑**真实 OpenAI embed 验收 | U02 `forbidden.embedding-runtime` | build `3bff8172`；Settings 搜索 Embedding 无命中 | verified | 3bff8172 | 2026-09-05 |
| T18-whitehair-open | WhiteHair local open：`sess_17b59bc0131c` `openProjectInput(input_whitehair)` → `LOCAL_REPLAY_UNSUPPORTED`（Adreno 650 `VK_EXT_fragment_density_map` vs RTX 5090）；SHA256 `03DF08D14E6D5819E5173209D9AC1218C2F740010104EC911A7873E97A258D42`；size `168591424`。BLOCKED-by-device；正路径改 U06 Android adb。不得标 verified | T18 硬件诊断 | `sess_17b59bc0131c` | waived-by-user | — | 2026-09-03 |
| UI-B0-governance | Renderer 治理：保真仅约束产品语义；`renderer-contract.json`；`check:design-tokens` / `check:renderer-structure` | `check:design-tokens` `check:renderer-structure` `check:gates` | disposable Browser QA；无 token | verified | f397d3d4 | 2026-09-08 |
| UI-B1-tokens | Token 收口：刻度补齐；primitive→semantic；hex 清零 | `check:design-tokens` hits=0 | disposable light/dark Workbench / Settings / Knowledge | verified | 66c2bc7c | 2026-09-08 |
| UI-B2-ui-kit | `ui/` 分子组件库 + Design System Preview 引用运行时 CSS | typecheck / lint / Preview 引用 `design-system.css` | Preview + `/qa` 各一张 | verified | 035caedc | 2026-09-08 |
| UI-B3-structure | features 按产品面重组；i18n 拆分；IPC 出 TSX | `check:renderer-structure` hits=0 | 冒烟：Settings / Knowledge / Terminal | verified | e9d72b0d | 2026-09-08 |
| UI-B4-settings | Settings 九节共用 kit；密度 32 | `check:settings-agents` Browser 1440/390 | disposable Settings 九导航 + 搜索高亮 | verified | 45a51b15 | 2026-09-08 |
| UI-B5-knowledge | Knowledge 三列 kit；列宽 224 / minmax(280,0.8fr) / 1.2fr；960 切换 | `check:knowledge-system` | disposable 三列空态；case TOC 仍为章节锚点 | verified | b71efb41 | 2026-09-08 |
| UI-B6-composer | 删除 energy orbit；壳 radius-lg；底栏 Pill 高 28 | `check:work-process` 禁 orbit；`check:appearance` | disposable 底栏互斥；无真实 provider 未验 Stop/Rewrite | verified | 093caa82 | 2026-09-08 |
| UI-B7-chrome | Right Rail 空态改 EmptyState；Sidebar/Device `is-selected`；Terminal 去掉 256px 字面量 | `check:right-rail` `check:design-tokens` STOP_COLOR_EXEMPT 空 | disposable 1440 五卡空态无插画；390 drawer overflowX=false | verified | 950fb311 | 2026-09-08 |
| UI-B8-copy-a11y | Threads→Sessions；DeviceSelector/Slash/Rail/Agent 模板入 i18n；Settings 搜索焦点环；hover 配 focus-visible | `check:right-rail` i18n keys | disposable ZH 工作台/User menu/Settings/Knowledge；device aria-label「回放设备：本地回放」；无 FULL_ACCESS 故 EN 未持久化 | verified | 634892ff | 2026-09-08 |
| UI-B9-finalize | fidelity 基线复核；docs 路径；全门禁 + build；交还桌面启动权后 push | `check:fidelity` `check:legacy-residue` `check:gates` `typecheck` `lint` `build` | disposable FULL_ACCESS=1；project `proj_5b660f23c308` session `sess_316a6244e3a4`；1440 五卡 EmptyState + Composer pill 高 28 + 九 Settings 节 + 搜索 compaction→策略 + 六 Knowledge lane 无 Semantic + 底栏互斥 + fail-closed unknown/internal/secret/desktop-only 403 且 `session:list` 200；390 `bodyMin=0` overflowX=false drawer=true；Appearance `settings:set` light 持久化后恢复 dark。截图 `%LOCALAPPDATA%/Temp/cursor/screenshots/b9-*.png`。无真实 turn 故 Memory/Tool 审批未跑。command palette 合成 Ctrl+K 未打开属自动化限制 | verified | 8836d929 | 2026-09-08 |
| UI-C2-second-pass | Composer 底栏单行同高 28、窄屏图标化、model 线性渐隐；空工作台窄卡居中；Right Rail 空态恢复 restrained visual；审查漏项收口 | `check:design-tokens` `check:renderer-structure` `check:right-rail` `check:appearance` `check:fidelity` `check:work-process` `typecheck` `lint` | disposable `qa-1788837336836-70ed95920ab5d922`；project `proj_da20cf5406f2` session `sess_92b9da32c26c`；1440 send/pill 均为 28、footer nowrap、五卡 visual 112×200 + honest copy；390 footerH=30 nowrap、agent/permission/effort 收成 28 图标、model 仍显示且 max-width 6rem、三卡 `align-items:center`、`bodyMin=0` overflowX=false。截图 `%LOCALAPPDATA%/Temp/cursor/screenshots/c2-*.png` | verified | bda24070 | 2026-09-08 |
| UI-D1-settings-eight | Settings 八项导航；Workspace 一级入口删除；资源与诊断改到常规页 TaskDialog；搜索「工作区 / paths」仍跳常规 | `check:settings-agents` disposable Browser QA | disposable session `sess_bf3f3f195297`；八 tab；无 workspace section；截图 `%LOCALAPPDATA%/Temp/cursor/screenshots/` | verified | 032f819 | 2026-09-11 |
| UI-D1-knowledge-export | `knowledge:export` + `dialog:saveFile`；`rdc.knowledge-package/1` 剔除 provenance 与绝对路径，导出前 secret 扫描；再导入 session Draft、verified=false，重复 cardId 走 conflict；Markdown 只供阅读 | `KnowledgeExportService.test.ts` + live IPC round-trip | disposable；写出 qa-export.yaml / qa-export.md 再导入仍为 draft；7 条单测覆盖 secret、重复 cardId、相对路径 fail-closed | verified | 032f819 | 2026-09-11 |
| UI-D1-overlay-stack | `overlayStack`：Escape / Tab 只作用栈顶；Popover / TaskDialog / Settings / Knowledge 注册；知识导入弹窗与 backdrop 平级 | typecheck + disposable Browser QA | disposable；颜色 Popover Escape 不关 Settings；知识导入 Tabs 不关 Center | verified | 032f819 | 2026-09-11 |


## 2026-09-09 原生协议与指令收敛验证（未提交工作树）

本节记录本地工作树的实测结果，不为未提交代码填写 verified/Commit SHA，也不追认 U06 旧实验。

- 外部原生 parser：生产 invoker 编译出的全部 probe argv / JSON 标志通过；虚构动词和应用 session ID 参数被拒。
- 真实本地 replay：临时 capture 副本、独立 daemon context，生产 executeRdxShell 及签名回执写入路径完成 shader 介入、渲染目标导出、回滚、恢复。测试签名 key 注入隔离存储；OS safeStorage 的生产签名能力没有用该单测替代验收。
- 两次成功验证的末次制品位于本机临时目录 rdc-native-receipts-6ufgG6；baseline/restored PNG SHA256 均为 00290fb97b6c6fd1f106e152615a171cd82c67ce6ee81447e8a398efad8946b8，variant 为 1efbcedcdc3f85f444c0acbbf20dfb4216532ec86f051e05cc18f41554bdae81。源与副本 capture hash 均保持 c50cd1e7c29241c64fd33faf07cb35e802f9dc85692a8512aa36db01c956b385；finally 回滚遗留 replacement 并停止本次 daemon。
- screenshot 显示链在此前实验中未反映变体；成功结论仅覆盖实际 render-target texture export，不能扩写为 preview/screenshot 呈现正确。Remote/Android 无本轮设备正路径证据。
- disposable Browser QA smoke 通过 /qa cookie bootstrap、/app 鉴权、Origin 拒绝、app:getMeta；完整 GUI 点击/截图因自动化运行器 Windows CreateProcessWithLogonW 1385 未完成。未使用真实用户会话。QA 已停止，canonical instance.lock 不存在，桌面启动权已交还。
- typecheck、lint、check:gates、build 与最终 coverage 结果见本节末尾。此前 ShellTool OEM 中文 stdout 失败已定位为 wrapper 强制 UTF-8 解码；移除全局 Console 编码覆盖，保留 UTF-8 文件输出，并补 PowerShell Unicode / 调用方显式 UTF-8 原生程序回归。未降低断言。

指令成本只测静态注入正文：相同 profile + 默认 coordinator，使用仓库 gpt-tokenizer 估算；不包括系统/工具 schema、用户历史、按需方法、项目根指令，也不冒充完整模型请求 token。普通任务与 Knowledge 查询均以 General 默认入口为基准，是否实际调用 Knowledge 由任务决定。

- General（普通任务 / Knowledge 查询）：正文字符 3337→1102；估算 token 691→310。
- Debugger：正文字符 6588→1543；估算 token 1469→462。
- Analyzer：正文字符 6873→1643；估算 token 1507→466。
- Optimizer：正文字符 6651→1573；估算 token 1462→467。

根 AGENTS 归一化换行后 35377→7563 字符。四个 coordinator 文件（含 frontmatter）分别为 613 / 958 / 1061 / 993 字符，27 个技能 ID 保持。静态正文数字与下述完整 PromptPlan / 真实请求数字分别记录。


真实请求成本验证（用户限定最多两次，无重试）：生产 PromptPlanBuilder，General 同一段合成代码问题、相同 DeepSeek V4 Flash 参数，before/after 各一次，均正确修复 i<n 边界，无提问、无 handoff。before input/output/total = 1644/137/1781；after = 1200/210/1410；cache hit 均为 0。输入下降 27.0%，总 token 下降 20.8%。这是受预算约束的单轮文本对照，不是五场景多轮 Mission 成本结论；工具轮数未测。请求预算文件 used=2，禁止默认测试触发外部调用。完整 PromptPlan 字符数：General 7184→4949、Debugger 10449→5404、Analyzer 10725→5495、Optimizer 10514→5436；制品在本机临时 rdc-convergence-bench-c3f1cbdb20/instruction-cost。

应用生命周期实测：RdxNativeLifecycle.test.ts 使用真实 production SessionService → configured action → ShellInvocationService / invoker，副本 capture open、registry/context query、preview status/off、context clear/lease 清除通过；finally 停止独立 daemon，源与副本 hash 不变。preview off 必须收到所属 context 且 preview.enabled=false 才显示关闭；openPreview 空成功载荷不再被补成 open。Android prepared remote 只消费一次，成功或失败后重试都须重新连接，已有单测；真实 adb devices -l 列表为空，Android 正路径仍受硬件阻塞。

GUI 验收仍待外部条件：浏览器自动化与独立桌面自动化内核均在启动时返回 Windows CreateProcessWithLogonW 1385，无法点击或截图；HTTP smoke 不替代 GUI。实际 render-target A-B-A 结果不替代 screenshot 显示链验证，也不替代真实 provider 多轮 Mission roundtrip / OS safeStorage 的完整产品验收。

最终本地门禁（2026-09-09）：pnpm 11.7.0；typecheck、lint、check:gates、build、git diff --check 均通过。全量 333 个测试文件通过 / 4 个外部测试文件默认跳过，2471 tests passed / 4 skipped；四个 opt-in 外部测试（native parser、签名 A-B-A、应用 lifecycle、两请求成本）均已分别显式运行通过。coverage ratchet：lines 73.44%、functions 75.70%、branches 60.78%、statements 71.14%。shared export 基线已为新增编译入口重建；未改 CSS，renderer fidelity 基线保持。


## 2026-09-09 第二阶段：通用 Harness、交接 v2 与 GUI 验证

本节为当前未提交工作树验证，基底 HEAD 为 9be5141cd33225111aa7c1313c8b92389d0aa58a；不把旧 SHA 的 verified 扩大为本次真实模型验收。上节关于 GUI 1385 的阻塞描述保留为历史，本节记录其解除。

实现：General/core/execution-orchestrator 常驻正文通用化；新增 renderdoc-investigation（28 个 builtin Skills）；三种 Mission 使用六块共享 Markdown Plan。agent_handoff 的 route/execute/return 合同绑定 Plan URI/hash、必需 Skill、真实返回对象及交付要求；主进程冻结校验策略，收口通过通用接口连接现有 Investigation 校验器。两轮执行均允许回评估，第三轮拒绝；[INCOMPLETE] 出口只结束 turn，不提升报告状态。handoff v1 原字节归档、v2 单轨、旧待续跑显示重新建立提示。普通 Capsule 无 RDX 段，显式领域扩展仍受租约、串行与回收约束。

实际通过：

- pnpm 11.7.0 typecheck、lint、check:gates、build。完整 tests 为 337 files passed / 4 skipped，2482 tests passed / 4 skipped；coverage ratchet lines 73.50%、functions 75.77%、branches 60.96%、statements 71.21%。Windows 沙箱阻止 Knowledge 安全测试 realpath 访问祖先目录，完整门禁在宿主环境执行，未修改产品路径检查。
- HandoffProviderFixture 使用确定性 ProviderStrategy + 真实 AgentLoop、RuntimeToolAssembly、HandoffStateStore、SessionArtifactResolver、InvestigationArtifactService；三类代表 Plan、直接 Mission/General 路由、Small Loop、一次 Big Loop、第二次回评估、第三轮拒绝、错误返回、重复 consume、取消和重启降级通过。另有缺失/损坏/hash/跨 session 引用、必需 Skill 去重/缺失/权限冲突及 v1 原字节迁移单测。它不是实际模型规划质量验收。
- 真实原生 CLI 两项通过：RdxNativeExecution 验证实际 render-target texture 的 A-B-A 与主进程签名回执，RdxNativeLifecycle 验证应用 action 打开、所属 context、preview off 和关闭租约。原生 runtime state 在独立临时 tools root；现有共享 CLI context 达到数量上限时不删除用户 context。源 capture 与副本 hash 保持不变。制品为本机临时 rdc-native-receipts-ifHtEo / rdc-native-lifecycle-pHnpni；测试签名 key 不等于 OS safeStorage 的产品验收。
- GUI 宿主恢复：策略备份 rdc-gui-rights-20260909-163648/before.inf，仅为 CodexSandboxUsers 增补 SeInteractiveLogonRight，其他登录策略及 elevated 沙箱不变；普通执行与 CUA 宿主均启动成功。
- disposable Browser QA 实际访问一次性 /qa 后的同源 /app，点击 Settings / General 指令、Skills 设置、Plan 展开、失败详情，键盘 Enter 收起，检查 disabled / selected / focus；820px 窄屏 document.scrollWidth=clientWidth=820。Composer 本地 /skills renderdoc-investigation 显示待发送预载，未发送模型请求；旧 v1 fixture 在真实 session select 后显示迁移提示并生成 v2 与归档。会话/Plan/Checkpoint 为生产存储服务写入的明确 GUI fixture，错误行是显示样本，不冒充真实模型轨迹。截图 qa-general.png、qa-plan-wide.png、qa-plan-narrow.png、qa-skill-entry.png、qa-handoff-migration.png 保存在本轮仓库外可视化产物目录。
- Browser QA launcher 66464/Electron 48132 及子进程已停止；桌面 scripts/start-rdc-agent.cmd 另以临时用户目录实启。沙箱桌面 GPU 启动失败，宿主环境同入口加载 file renderer 成功、无占锁失败；launcher 59152/Electron 3816 及子进程已停止。canonical instance.lock 不存在，临时锁 owner 已死；桌面启动权已交还。

离线成本比较使用生产 PromptPlanBuilder；相同工具能力、日期、权限、空外部历史和项目指令，覆盖 core、profile、完整 Skill 目录与按需正文。HEAD 为历史基底，并非第二阶段开始前快照；下列数字为字符和估算，非真实账单 token。本阶段零真实 LLM 请求，先前两个授权请求已耗尽。

- 普通聊天 / 轻量 coding（各一项）：10606 → 8418 字符（-2188）；当前估算 2103 token。
- Debugger 规划：13871 → 9105 字符（-4766）；当前估算 2274 token。
- Analyzer 规划：14147 → 9134 字符（-5013）；当前估算 2282 token。
- Optimizer 规划：13936 → 9124 字符（-4812）；当前估算 2279 token。
- General 调查执行（含三项方法）：17919 → 14445 字符（-3474）；当前估算 3609 token。

当前 General 调查执行比普通 General 额外 6027 字符，体现领域方法按需成本；不预设真实多轮节省比例。完整分段结果在本轮 prompt-cost.json，左全局→虚线→右细节图已同步。

后续专项：Android 真机；真实多轮 Mission 稳定性、正确性与设计符合性；原生 screenshot/preview 呈现链；生产 safeStorage 签名完整产品验收。既有 CLI/fixture/GUI 结果均不替代这些专项。未提交或推送，未创建或切换分支。


## 2026-09-09 截图反馈：工作台 UI 遗漏收敛（未提交工作区实测）

基底 `8d35ed310ffa6a1ea3d31142fdc7be210aab3f53`；本段记录当前工作区实测，不借用历史 SHA 标记新 diff 为已提交 verified。源码差异指纹（`git diff -- src scripts` 加新增 ComposerSendButton.css 原字节的 SHA-256）：`84d96c93c653a074de59e43ea1837a9393cfde5c0c5f219d334795718f34b034`。

修复范围：App 实际接入 AppShell；Knowledge / 用户入口共享 ghost Button 与 36px 行高；项目 Capture 共用 SectionHeader / Button / EmptyState 与紧凑文件行；Send / Stop 共享 Button 状态，28×28、agent accent 实色发送、变量配置圆角；用户菜单初始焦点与 Escape 返回。删除未接线壳层里的旧 footer / placeholder / 装饰与全局 focus 覆盖、原侧栏设备 variant、旧发送/停止样式及重复 Capture 覆盖。sidebar 为实色。增加壳层 CSS 从 renderer 入口可达性门禁，fidelity 清单只移除本轮实际退役 class。

实际通过：

- typecheck、lint、完整 check:gates、最终 build、git diff --check；最终完整测试 337 files passed / 4 skipped，2482 tests passed / 4 skipped。受影响 renderer 单测 23 files / 107 tests 通过。覆盖率 lines 73.50%、functions 75.77%、branches 60.96%、statements 71.21%，coverage ratchet 通过。首次并行覆盖率有三个负载超时，降低到两个 worker 后完整通过；Knowledge 沙箱祖先路径限制通过宿主执行复核，未放宽断言或产品校验。
- disposable Browser QA 同源真实应用：空 Capture、`project.inputs.importPaths` 导入两个明确 UI 列表样本、刷新 busy/disabled → 两文件列表；中英文、Light/Dark；长中文文件名与完整 title/accessible label；Knowledge 打开关闭、顶部本地设备选择；Send 空草稿禁用/有草稿启用，Tab 可到 Send 且 agent accent 焦点可见，未点击发送。
- 最终 390 CSS px：`documentElement.scrollWidth = innerWidth = 390`，七个 Composer 控件高均约 27.992px（显示比例下等于 28px）；右侧文件抽屉、左侧导航抽屉均可开关。用户菜单首项获得焦点，Escape 在宽屏返回用户入口、窄屏返回左栏展开按钮；侧栏入口同高约 35.994px，Send 圆角 9999px、background-image 为 none。
- Browser 截图相对证据目录：`8d35ed31/ui-convergence-20260909/ui-workbench-dark.png`、`ui-workbench-light.png`、`ui-capture-390-dark.png`、`ui-composer-390-light.png`。最终 QA projectId `proj_bd3db12a4f21`，无 session、无模型请求。列表文件内容明确为 UI fixture，不代表真实 capture 回放；原生文件选择器、真实模型运行中的 Stop、Remote/Android 未作本轮实机验收。
- `scripts/start-rdc-agent.cmd` 使用独立临时用户目录实启，加载 `file:///.../out/renderer/index.html`，无占锁失败。测试 Electron owner 60776 / 20544 / 70060 / 22408 / 38716 及对应 launcher/子进程均停止；canonical instance.lock 不存在。桌面启动权已交还。

未创建/切换分支，未提交或推送；既有 `.cursor/` 未修改。

## 2026-09-09 用户菜单切换与 Capture 标题栏补充验收（未提交工作区）

- 来源：用户补充截图。基线仍为 `8d35ed310ffa6a1ea3d31142fdc7be210aab3f53`；当前 `git diff -- src scripts` 加新增 ComposerSendButton.css 字节的 SHA-256：`778c2e1d8414ee620b5979dbbaa7979f21dcfb5ddbd86a8806d48677bd566406`。此前验收段落保留为历史，不代表本次 diff 的全量测试结果。
- 菜单：真实 Browser 鼠标连续点击入口，open true → false；Enter 同样切换；Escape 关闭并返回入口焦点；点击 Capture 标题关闭菜单；aria-expanded 同步。
- Capture：两个操作迁入 SectionHeader actions，共用 IconButton；旧 actions / primary / refresh 局部类已退役。真实刷新成功保留两条隔离 fixture；中英文与深浅色桌面实测，两个按钮均约 28×28 CSS px；390px 窄屏几何检测无横向溢出。
- 本次门禁：typecheck、lint、check:right-rail、check:design-tokens、check:renderer-structure、check:appearance、git diff --check 通过；sidebar / scopedCapture 定向测试 2 文件 2 测试通过。桌面 launcher 本次重建并加载 renderer 成功。
- 限制：本次为局部 UI 回归，不冒充此前全量 tests/coverage 对新 diff 的证明；未操作真实账号或原生导入文件对话框。项目和 capture 均为隔离 QA 测试资料。
- Browser 证据：`ui-convergence-20260909/ui-followup-dark.png`、`ui-convergence-20260909/ui-followup-light.png`（基线 SHA 的本机 QA 目录）。
- 启动权：本轮 Browser owner 44420 / launcher 19376 与 desktop owner 49416 / launcher 45560 均已停止；canonical instance.lock 不存在。桌面启动权已交还。

## 2026-09-09 Composer 窄宽穿插修复（未提交工作区）

- 基线 `8d35ed310ffa6a1ea3d31142fdc7be210aab3f53`，当前 source/scripts diff 加新增 ComposerSendButton.css 字节 SHA-256 `21f7d66c908bc978bb51f77c819b59062ca69af5c47e734be30c5c9b982a6371`。此前全量测试记录只证明此前快照。
- 删除 responsive.css 的 Composer footer/group 重复布局；固定图标与左组尺寸，仅 Model wrapper 可收缩。窄屏保留单行及图标化，Model 宽度自适应并仅在实际溢出时渐隐。<=720px 内容轨道取消桌面 77% 上限。
- 最新 build Browser：320px / 390px / 1023px viewport 均测量按钮无相交且同一行；1023px 时 Composer 宽584px。320px 模型文字46px、内容80px，mask生效；390px能容纳时mask=none。中英文、深浅色已观察；模型菜单可打开、Escape关闭。使用隔离项目与无provider状态，未请求模型。
- 验证：typecheck / lint / build / design-tokens / appearance / renderer-structure / diff whitespace 通过；Composer 20文件101测试通过。未再次执行全库 tests/coverage。
- 截图：`ui-convergence-20260909/composer-320.png`、`ui-convergence-20260909/composer-390.png`，本机基线SHA的QA目录。
- 最终桌面入口已加载 renderer；QA 24964/42780 与桌面 31976/56528 均已关闭，canonical instance.lock 不存在。桌面启动权已交还。

- 2026-09-09 完整改动约束复核：修复 touched Composer CSS 的 CRLF 与 fidelity 精确匹配冲突，按 .gitattributes 归一 LF；未改变动画语义或放宽门禁。当前完整 `pnpm run check:gates` exit 0（含 fidelity、architecture、session-projection、right-rail、legacy-residue、acceptance-ledger、design-tokens、renderer-structure）。全库 tests/coverage 仍以各历史快照为界，不冒充本次重跑。


## 2026-09-10 通用 Harness 收敛：领域/上下文定向验证（集成待收口）

基线 `cfb7eaa0e24d7a7eb74afa25ff246d2551f4bae7`，本轮未提交工作区。下列为受控测试，不代表真实模型、native RDX 或最终全库验证。修改期间跨过零点；五日审查入口仍采用任务开始时 2026-09-05 至 2026-09-09 的窗口，提交明细由本轮审查记录给出。

- 已验证：通用 handoff 不推断 Big Loop、不自动绑定最新 Checkpoint；普通 General 不受 Mission 完成要求；执行绑定不能用 partial 绕过返回。领域/Hook/完成/RDX 初始组合 9 文件 122 测试通过，后续 RDX 身份与 orphan scope 修正已单独复测。
- 已验证：父子 RDX 控制互斥；未确认 native close 继续托管，相关 context 隔离、无关 context 不被锁住；恢复失败保留绑定；确认 close/open 后产生新版本，旧 prepared turn 拒绝执行。重开不作为 rollback 证明。
- 已验证：Capsule 数据仅进入子 user 输入，必需 Skill 显式预载；输入 hash 授权只读，子输出归原调查且重开仍可读；不能借 read grant 覆盖父产物。嵌套执行只向直接父级转交已登记输出的只读引用。
- 已验证：压缩 Checkpoint 保存完整原始 Journal、Task/执行及领域权威记录；50k 字符消息尾部条件保留，archive 分块可分页重建；写失败/校验失败报错，保存失败不提交新 view。相关 context、Skill/PromptPlan 定向测试通过。
- `TODO(UNVERIFIED)`：最终后台执行合同、父 Provider 实际请求端到端、全部 tests/coverage/gates/build、disposable Browser QA 与真实模型/原生设备场景由集成收口阶段验证。本段不得独立作为整项完成依据。
- 本子任务未启动 QA/Electron，未占用桌面启动锁；若集成阶段启动，必须另记录清理及「桌面启动权已交还」。


## 2026-09-10 Harness 审查依据及新增定向证据（全量验收仍待收口）

审查入口：北京时间 2026-09-05 00:00（含）至 2026-09-10 00:00（不含），使用本地 Git 提交时间窗口 `git log --since=2026-09-05T00:00:00+08:00 --until=2026-09-10T00:00:00+08:00`，共 33 提交；当前实施跨过零点，不把窗口无记录地滑动。基底 HEAD cfb7eaa0e24d7a7eb74afa25ff246d2551f4bae7，交付为未提交工作区，`.cursor/` 保留；桌面原稿未修改。

| Harness-audit-1 | 保留单一 loop、prepareTurn 冻结、权限交集、共享预算、代次过滤、durable handoff、领域原生回执；移除 General→Mission+depth 推断 Big Loop、隐式最新 Checkpoint 选择及正文前缀控制终态。通用校验执行回交绑定，领域继续验证 Checkpoint/实验/报告。 | 五日提交审查：8d35ed31；最终工作区验证待收口 | — | planned | — | 2026-09-10 |
| Harness-audit-2 | 保留历史及 shadow seed 退役与 v2 迁移，不恢复官方 Scout/Skeptic 身份或旧 seed 双轨。 | 五日提交审查：7fdd56f1；最终工作区验证待收口 | — | planned | — | 2026-09-10 |
| Harness-audit-3 | 保留六 lane markdown-first Knowledge、固定 read roots、无 Embedding；Scout 仅追加受控 artifact_read 和 turn_complete，不增加 Candidate/持久 Memory 自动写入。 | 五日提交审查：3bff8172、a31d6c00；最终工作区验证待收口 | — | planned | — | 2026-09-10 |
| Harness-audit-4 | 保留 legacy residue 与组合门禁；更新被本轮 canonical Task/结构化完成替代的测试和断言。 | 五日提交审查：60ed27dc、36fff8a4；最终工作区验证待收口 | — | planned | — | 2026-09-10 |
| Harness-audit-5 | 权威边界及阶段验收历史作为来源保留；不拿旧 verified 行证明当前工作区。 | 五日提交审查：fbf5d639、5caefbbc；527e172a、9705c04b、5b158e9b、a21f7c37、85bb50ce、71a81a99、f5ff7205、c88be040；最终工作区验证待收口 | — | planned | — | 2026-09-10 |
| Harness-audit-6 | UI/本地化/分层/验收历史保留；沿当前会话投影接线检查，不以领域边界修复为由重写既有 UI。 | 五日提交审查：cc473444、9f27d43b、f397d3d4、66c2bc7c、035caedc、e9d72b0d、45a51b15、b71efb41、093caa82、950fb311、634892ff、8836d929、3a4037f4、bda24070、053330b5、9be5141c、cfb7eaa0；最终工作区验证待收口 | — | planned | — | 2026-09-10 |

新增受控验证：资源仲裁、ProcessSupervisor bounded join、ToolExecutorFactory、toolConcurrency、DebuggerRuntimePolicy、HandoffProviderFixture、Investigation contracts 共 **7 文件 58 测试通过**（2026-09-10 00:26，两个 worker）；相关实现 ESLint 通过。覆盖预取消、取消排队写任务后读任务放行、进程未退出隔离及真实 close 后解锁、精确执行会话进程所有权、结构化预算暂停与两轮执行约束。Knowledge 来源门禁已更新，沙箱运行的两项 realpath EPERM 不能解释为产品失败或通过；宿主复核由全量阶段记录。

原生专项（主执行者报告，2026-09-10 00:21:48）：独立临时 tools 与 vkcube 副本，**2 文件 2 测试通过**，约 27.83s；证据位于本机 TEMP/rdc-native-receipts-LymeYf/validation.json 与 TEMP/rdc-native-lifecycle-jPMM8H。A/restored SHA-256 `52e503065984534330ee321dbca53e164f87ee4d646b5826fc2041bbd28d13c3`，B `e1d873b5e3bdef3d6bfa784b83fe6b5c83e892e275daee8401ae66ca6f7e1357`，源 capture 未修改。这证明该次 native 回执/生命周期路径，不是后来资源仲裁 diff、真实模型调查或 Remote/Android 验证。

当前责任边界：runtime 强制权限、依赖/代次/执行结果、预算、消息所有权与消费、取消/join、进程资源和产物完整性；实际加载的 execution-orchestrator/renderdoc-execution/knowledge-scout/skeptic-review 指令决定工作拆分、探索、独立审查、补证及回评估。计划要求覆盖与科学结论不可由通用代码猜测。

`TODO(UNVERIFIED)`：最终后台消息/收口/取消集成、父子实际 Provider 输入验收、全量 tests/coverage/check:gates/build、Browser QA 和真实模型场景仍须以最终同一 diff 单独收口。执行期间的局部绿色记录不自动升级整项状态；不得承诺总 token 下降。若主执行阶段启动 QA/Electron，须在最终记录补充进程清理和桌面启动权交还证据。

- 2026-09-10 00:27 宿主复核：check-knowledge-system 与 check-investigation-system 均 PASS、hits 0，涵盖上述最新契约 fixture 更新；沙箱 EPERM 未通过修改安全检查规避。

- 2026-09-10 00:33 追加 Capsule 本地预算实现：子账本按本地上限预留，消费同步计入所有祖先；不修改父上限，不复制账本替代共享计费。派发、嵌套和重试不能重置根消耗；截止时间继承祖先 deadline，并取消等待中的 Provider。DelegationBudget/SubagentRunner/TurnCoordinator/ToolExecutorFactory **4 文件 43 测试通过**；类型检查通过。实际加载 Skill/PromptPlan/scoped resources **5 文件 20 测试通过**。后续同一文件并行集成仍须全量复测。

- 2026-09-10 00:47 追加子执行审批/信息请求验证：exact parent owner 响应、跨会话/null/child 身份拒绝、单次消费、取消与迟到响应；完成后的父消息投影保留正文和状态，控件使用真实 child turn/toolCallId；重启后无主进程 pending 的旧问题取消。相关 **7 文件 34 测试通过**。受影响类型检查/ESLint 已分次执行，最终集成与 Browser 控件操作仍待主执行者收口。

- 2026-09-10 01:02–01:04 新增受控证据：ExplorationReviewProviderFixture 实际 AgentLoop / SubagentRunner / PromptPlan / 领域工具 / handoff 捕获父子 Provider 输入，Scout 与 Skeptic 独立会话，原始来源未整体回灌；Challenge 后 General 读取原证据核查条件并回原 Mission，缺少 driver Y 实测诚实保持 partial。图像经过 artifact_read、结果外置路径后仍以 image block 到达子 Provider 输入。此为受控 Provider fixture，不是真实模型科学判断或新 driver 实验。
- 同期 ArtifactReadTool + ToolResultArtifactizer 2 文件 9 测试通过：根 Session 托管子执行大结果、精确 hash/read grant、分页重建完整错误尾部、视觉内容不被重复外置。ToolResourceArbiter 1 文件 10 测试通过：跨项目 unsafe effects 保守串行、无关只读并行；未确认退出同时保留局部与全局 unsafe 资源，真实退出解锁。最后全库验证仍由最终 diff 收口。

- 2026-09-10 01:17:14 主执行者重新验证最终资源仲裁路径：RdxNativeLifecycle + RdxNativeExecution **2 文件 2 测试通过**，28.68s；证据 TEMP/rdc-native-lifecycle-Qir217 与 TEMP/rdc-native-receipts-y1oZ6I/validation.json。限定 python/rdx 且 command 含本轮 rdc-native- 的进程检查为空。这是该次本机原生路径证据，不能升级为真实模型、Remote/Android 或尚在修复的后台集成验收。

## 2026-09-10 Harness 最终收口（未提交工作区）

本节替代上方本轮各阶段的“集成待收口”状态；那些日期、失败与局部证据保留为历史。基底 HEAD 为 `cfb7eaa0e24d7a7eb74afa25ff246d2551f4bae7`，未提交或推送、未切换分支，`.cursor/` 和桌面设计原稿未修改。最终 src/scripts/resources 共 165 个修改或新增文件的原字节清单 SHA-256 为 `255676af6c62e98f0dd01bd90597a8fea394f604a811d27e2efca84442e46501`，冻结于 2026-09-10 12:59；权威文档在其后补齐验收记录。未给本地 diff 冒填已提交 verified SHA。

### 已有能力、实际缺口及关闭结果

- **单一 AgentLoop、prepareTurn、持久 handoff、领域回执**：删除按 General/Mission/depth 推断 Big Loop、最新 Checkpoint 隐式选择和正文前缀控制；通用执行返回绑定独立于领域完成证据。验证：HandoffProviderFixture、通用完成及领域合同；普通 General 真实简单问答与后台工作均不进入 RDC 流程。
- **TaskStore 和子执行**：canonical Task v2 区分逻辑任务/执行/代次，绑定依赖和必需输出；补后台托管、取消/join、事件消费及共享预算；替代旧 v1 运行读写。验证：最终全量包含依赖、重试、预算预留失败、取消间隙、停止自身、重复/迟到事件、重启手动恢复与存储失败负路径。
- **Capsule、PromptPlan、Session Artifact**：结构化且有界回传，原始输出保存在所属 Session；Compact 从权威记录保存并核验后提交；必需 Skill 冻结。验证：受控真实 Provider 请求构建链、原图 image block、跨 Session 拒绝、hash/分页重建、失败不丢上下文；真实 OAuth 请求及重启读取另见下文。
- **六 lane Knowledge、RDX 独占控制**：保留无 Embedding/无自动晋升；按完整执行区间控制 live lease，未知退出隔离、mutation 不确定先核对、主进程受控重绑定。验证：原生 parser 与 A-B-A/close/open 独立专项已通过；资源/权限/迟到回执负路径进入最终全量。
- **Browser 事件流、Agent seed COW**：真实 QA 发现 GET EventSource 缺 Origin 导致 401、显式 model-only override 被 seed 当 shadow 清除。验证：改同源 POST fetch SSE，严格 cookie/Origin 不变；显式用户保存使用同一迁移锁与 retained marker、保存失败恢复原字节；实际 UI 事件与重启后 Luna 路由保留。
- **结构化完成和后台适配器**：真实 QA 发现 turn_complete outputs schema 与通用校验器冲突、unresolved 被错误提升为 missingRequirements、后台事件污染同步等待/最终回复。验证：保留字符串输出类型及必需输出校验；未解条件按原认识等级回传；后台生命周期只经 Task/mailbox，审批入口保留。定向 5 文件 45 测试及最终全量通过，随后真实模型复验通过。

五日 33 提交的分类与依据为上方 Harness-audit-1 至 6，审查现已关闭。8d35ed31 中的通用循环/冻结/领域回执机制保留，越界调度与完成推断删除；7fdd56f1 历史 seed 迁移保留，修正显式用户配置被清除的路径；3bff8172/a31d6c00 六 lane 与 60ed27dc/36fff8a4 legacy/gates 机制保留；其他 UI、架构与历史验收提交沿调用链复核，未扩展无关设计。未以改名、新配置或兼容双轨代替收敛。

### 最终验证

- 完整 `vitest run --coverage --maxWorkers=2`：**361 文件通过 / 4 文件按既有开关跳过，2619 测试通过 / 4 跳过**；2026-09-10 12:59:04 开始，163.25 秒，exit 0。覆盖率 statements 72.00%、branches 62.00%、functions 76.53%、lines 74.31%；coverage ratchet exit 0。跳过项为三项显式原生测试与双请求成本比较；前三项已另跑，未虚构新的成本比较。
- 最终 typecheck、lint、build 通过；最终 check:gates 与 whitespace 核对由本节追加记录给出。未删测试、未放宽阈值，Knowledge realpath 检查通过主机身份运行，未绕过权限逻辑。日志为本机 TEMP 下 `rdc-harness-final-{coverage-3,ratchet-3,typecheck-6,lint-6,build-3}.log`。
- 受控模型集成：ExplorationReviewProviderFixture 使用生产 AgentLoop / SubagentRunner / PromptPlan / handoff，Scout 独立探索、Skeptic 独立上下文形成 Challenge、General 按引用补证、回原 Mission 评估；未测 driver Y 保留 partial。该测试证明执行和输入契约，不冒充真实模型科学结论。
- 原生专项最终资源路径：01:17:14 的 RdxNativeLifecycle/RdxNativeExecution 2 文件 2 测试、28.68 秒；A/restored hash `52e503065984534330ee321dbca53e164f87ee4d646b5826fc2041bbd28d13c3`，B `e1d873b5e3bdef3d6bfa784b83fe6b5c83e892e275daee8401ae66ca6f7e1357`。本轮后续修复不修改这些原生/资源源码。证据 TEMP/rdc-native-receipts-y1oZ6I/validation.json 与 TEMP/rdc-native-lifecycle-Qir217。

### 真实 Browser / OAuth 行为证据

按用户授权，以本设备授权的隔离副本打开 `D:\Projects\agentTest\rdc`，project `proj_fb313da0eedd`、新 session `sess_9fd6daa3c1e2`；真实路由 **chatgpt-account / gpt-5.6-luna / low**，由保存的 Provider 请求与 usage 验证。以下为真实应用，不是 renderer demo 或 fixture server。原项目 capture 未打开或修改。

- 简单 General 请求 19×29 得 551，未创建 Task 或调用工具；POST SSE 正常使 UI 退出 Working。
- 两个独立后台执行 `execution_1789016216461_aba0744d` 与 `execution_1789016217025_9c06b17f`，实际 Provider 运行区间重叠 **59710ms**。父 turn `turn-ec808cbbc916-1789016181581` 于 12:57:02.604 正常结束；子请求持续至 12:58:00.161 / 12:58:03.254。父回复后执行未被停止，完成后由事件分别续跑父模型，无模型轮询工具。
- 两个执行均 completed，analysis 分别 3423 / 3851 UTF-8 字节，4 / 5 条 unresolved 与 scope 保留；父输入只有有界投影、明确 externalizedFields 和 URI/hash，未回灌完整子分析或 transcript。实际请求逐项断言路由、Low、父历史隔离、条件保留及 artifact 字节 hash。可复查证据 TEMP/rdc-harness-real-qa-evidence/real-background-provider-proof.json 及脱敏 Provider records；不据此推断总 token 必然降低。
- 重启后无自动续跑；显式新请求经 artifact_read 读取 A 的同一 hash `40f1591d6fb54de6419154091f835b1b84439f775e49e42890995cd755ef7925`，恢复第一项测试输入/预期、顺序域未定条件与“仅设计、未执行”的适用范围。B hash `bddd5c69e534994b7f054b797b2a3b8ed3958a2ce933834077f9bf66363ab966` 同样通过磁盘字节核验。
- 真实运行的 QA-CANCEL `execution_1789016583064_374941db`：父回复先结束，点击 **Stop all session work**，545ms 后取消/join 完成并持久化 cancelled；UI 停止入口消失，后续未自动唤醒父模型。证据 real-cancel-proof.json 与 task-state-final.v2.json。取消期间没有 shell/RDX 副作用。
- 初次真实 QA 的失败记录原样保留：schema 拒绝、错误完成判定、父 final_answer 缺失；未用后来的成功覆盖旧执行。修复后的新执行具有独立 ID，未用重试重置旧预算。

### 责任、边界与桌面交还

runtime 强制权限/所有权/依赖/执行代次/输出存在/预算/取消/join/消息消费/产物完整性；调用方组织 Capsule，实际加载的 Agent/Skill/Prompt 与模型选择直接执行、重探索委派、独立审查、补证和 Small/Big Loop。Mission 最终评估仍在原 Mission；root 两轮 execute/return 是上限，不是自动循环次数。RDC 证据有效性、签名回执、实验恢复保留在领域工具与受控扩展。

本轮已复现的实现缺陷全部修正并复验。外部资格边界仍明确：Remote/Android 真机、本任务以外的 provider/model 组合、真实模型完整 RDC 科学调查的质量/稳定性未由上述受控链路证明；没有将其冒标为通过，也没有以这些限制掩盖已知实现失败。

本轮 Browser/Electron 已停止；最终桌面 `scripts/start-rdc-agent.cmd` 以新临时目录实启并加载 file renderer，未发生占锁失败。最后 Browser lock owner 36264、desktop owner 30448 均已退出；canonical `%APPDATA%/rdc-agent/instance.lock` 不存在，临时锁仅保留死 owner。授权副本及其 Local State 已删除，canonical 授权仍保留；未停止用户其他进程。**桌面启动权已交还**。

- 最终归档：上述 TEMP 证据已复制到仓库约定的本机 QA 路径 %LOCALAPPDATA%/rdc-agent-qa/cfb7eaa0/harness-20260910/，Provider 记录均为应用脱敏副本，无 token/cookie/secret。13:07 最终源指纹复核一致、git diff --check 通过。第一次最终 gates 在 ledger 三列表格上被固定七列 schema 拒绝，已改为条目说明，未修改门禁。

- 2026-09-10 13:10 最终聚合 check:gates exit 0，包含 contracts/Agent capability、会话投影、右栏、Knowledge/Investigation、legacy residue、acceptance ledger、Provider、release config、design tokens 与 renderer structure。日志 rdc-harness-final-gates-6.log；格式修正未触及冻结源码。最终 git diff --check 通过。


## 2026-09-10 产品与执行连续性收敛实测

基线 `e1d137b4`，在当前工作区继续修改；以下是未提交工作区的实测记录，不把该基线 SHA 当作新代码已提交证明。保留上文历史失败与撤回记录。本轮没有另建版本化引擎、Task 存储或 Compact 产品入口。

- 已复用：单一 Agent loop、Task/执行/mailbox/root budget、durable handoff、Journal、Artifact、PromptPlan、资源仲裁；Investigation 与 RDX 仍是领域边界。删除旧 session 派生窗口存储与按头尾/消息大小删减的模型压缩路径，统一在执行安全请求边界维护窗口。
- 实际加载指令已修正主动目标澄清、少量渐进问题、Unknown/skip/freeform 与授权分离、重知识隔离和独立 Skeptic、全文结果由 runtime 保存。工具搜索、Capsule 模型/推理参数、Task 精确输出键说明与实现相连。
- 受控测试：原始媒体 hash/授权/配额与读取恢复、Unicode 分页重建、冻结工具配对、候选安装失败/取消/状态变化、Provider opaque 状态隔离、父子预算/迟到消息/取消/join/重启手动恢复由对应合同测试覆盖。不得据此宣称所有 Provider 或原生实验现场通过。
- 真实产品、真实模型：隔离 userData，项目 `proj_c630c5bea6e8`（`D:/Projects/agentTest/rdc`），全部验收请求采用 ChatGPT OAuth `gpt-5.6-luna` / Low。`sess_bb6c6f8eea3d` 一句帧时间解释直接完成，无 Task/调查强制流程。`sess_fbdb96eea058` 从模糊白点经三题澄清，两个 unknown 与严格保留高光进入后续请求；历史 Mission 完成误判失败已保留，19:08 普通跟进正常结束。
- Analysis `sess_62810cf73cd4`：用户仅称偶尔卡顿，实际回答形成“新区域、0.5–2 秒、自己恢复、能否稳定复现未知”，20:16 后续回复给可交接记录模板且未猜测原因。19:54 误把澄清标为调查完成导致失败的记录不抹除；完成声明现先向模型返回可修正错误，最终报告门禁保持。
- Optimizer `sess_fbdb96eea058` 20:08：真实视觉请求收到两幅人工图，模型识别候选去掉右点但改变左侧高光大小/位置/形状及背景，拒绝把它当画质合格或真实项目实验成功；提问收敛质量标准。图像为受控样本，不是 capture Ground Truth。baseline SHA-256 `b5d349fc135787541abc64b2fa39df5f7f35eb58af68dd7ee9d7db0e293258ad`。
- 材料 GUI：Composer 实际上传、意图/条件/比较组保存、键盘移动 ROI、重启后原图可读。20:22 修复并验证跨消息同组对照；900×700 下 dialog clientWidth=867、scrollWidth=867，两张原图加载成功；Esc 后焦点回到 material-after.png 附件，viewport 已恢复。用户标注与工具观察明确分开。
- 长任务 `sess_e9b196a26a82`：700 行人工负载（不是测量）；原始来源 `session://tool-outputs/compaction-authority/130b0c66b071.json`，SHA-256 `91fc25741e266c289f8b4686321edd42a4d4b3a2761ab85d47375549a22a3d75`。首次过大输入外置，原始 JSON 可分页恢复。父多次、子执行 `execution_1789042078202_facd8c23` 连续三次真实压缩；压缩调用没有调查工具，实际读取覆盖原始分页，后续不能改名修订与原始不可修改分层。该子执行最终因 Task 输出键不匹配失败，不能以压缩 UI 成功宣称整体验收成功；对应权威键传递及声明预校验已修复并继续复测。
- 实际 Provider wire：20:20 前收集 52 份实际 fetch JSON body，52 份均 Luna/Low，tool call/result 集合逐份相等；9 次无工具调用，12 份只有 Capsule 用户输入的隔离请求，2 个原生 image payload。请求原 body 保存 SHA-256，导出脱敏结构不含认证头、原始 reasoning 或签名内容，图像载荷以 data URL hash/长度表示。这里的数字证明协议观测，不证明科学结论。
- 本机证据存于忽略目录 `.local/plans/product-convergence/`（wire-evidence.json、wire、QA 日志、测试日志），原始模型快照及媒体在本轮隔离 userData。不得提交授权副本或 bootstrap。此前全绿不能替代后续 diff；最终测试与清理结果在下方补记。
- 明确限制：原始文本与权威状态超出专用压缩调用预算时安全暂停，尚未证明任意长度连续压缩；未做 Provider 全路由原生 compaction 实测。完整真实项目 Ground Truth 按用户既有约定分期，本轮图像和长文本 fixture 不替代原生 RDX 因果实验、rollback 或跨设备验证。


### 后续复测与证据校验

- 20:24 新 Task `task_1789043133638_485fda58` 的执行 `execution_1789043157477_9d5c8a00` 已 completed，精确输出键为 analysis；完整结果 `session://tool-outputs/subagent-execution_1789043157477_9d5c8a00.json`，SHA-256 `458692f6b5ae68b9430776738d9f1f41a1fddcdc4a3b0b683072e66567f2c4a4`。父回复先结束，终态事件触发原父评估；父在再次自动压缩后正确将旧 artifact 的自述与原始分页证据区分，最终 partial 不冒充科学完成。
- 独立 wire 校验补齐双遍读取证据：对 `execution_1789042078202_facd8c23` 时段的实际 function_call_output 按 call_id 去重、游标顺序拼接。两遍各 5 页，分别重建同一个 SHA-256 `91fc25741e266c289f8b4686321edd42a4d4b3a2761ab85d47375549a22a3d75`，解析样本序列均严格等于 0–699。见 `double-pass-wire-proof.json`。这证明连续三次子压缩期间真实读取完整原始材料，不撤销该执行的完成字段失败，也不代表人工数据为测量。
- 最终核心回归：原用户权限完整 coverage 363 文件通过、4 跳过，2633 测试通过、4 跳过；lines 74.41%、functions 76.40%、branches 61.90%、statements 72.05%，coverage ratchet 通过。后续同模型恢复 Agent 身份的单点修复再跑相关 3 文件 49 测试通过；typecheck、lint、check:gates 通过，启动器实际构建并加载。沙箱下 Knowledge 8 项路径/权限相关失败独立记在 coverage-final.log，原用户权限复测全通过，未修改安全断言。

- 20:32 最终构建真实重启与 Session 切换后 General/Optimizer 均保持 Low。Artist 回答“严格保持高光位置/形状/亮度与背景”实际进入下一请求；回复将允许变化范围限定为右侧异常点，保留人工示意限定，未执行实验或修改。
- 独立 Scout→Skeptic→Challenge 补证→原 Mission 返回的完整调用链由 `ExplorationReviewProviderFixture.test.ts` 在实际 Agent loop/PromptPlan/领域工具组合上验证；这是受控 Provider 证据，不标为真实模型完成原生 RDX 因果闭环。

- 最终 wire 汇总为 64 份，全部 Luna/Low，逐份工具配对无缺失；11 次无工具压缩调用、15 份 Capsule 单用户输入请求。4 个图像载荷的 data URL SHA-256 与本地原图逐字节编码相同，确认没有用缩略图替代原图。统计包含多个安全边界，不等于独立执行数量。
- 清理：停止本轮 Browser QA、launcher 及 Electron 子进程；隔离 home（模型窗口/压缩阈值覆盖）与 secrets/Local State 授权副本已删除，保留会话及脱敏证据。canonical 桌面入口实际启动到 Settings/RDX/Debugger 初始化，未出现 userData 占锁拒绝，随后关闭本轮桌面实例；QA 与 canonical 锁 owner 均已退出，无残留 launcher。桌面启动权已交还。

- 20:36 最终全量复跑出现一项失败：BackgroundSubagentService 跨会话取消场景在写进度消息时遇到 Windows `EPERM rename task-state.json`（不是取消权限断言失败），其余 2633 项通过。已保留 coverage-delivery.log。补齐同一原子候选文件的有界 EPERM/EBUSY 重试，未引入备份切换或删目标路径；故障注入验证瞬时拒绝后仅提交一次、持续拒绝原文件字节不变且候选清理，相关 2 文件 16 测试通过。重新运行全量回归，结果补记于后。


最终复验（20:44–20:45）：`coverage-delivery-recheck.log` 全量 363 文件通过、4 跳过，2636 测试通过、4 跳过；lines 74.42%、functions 76.41%、branches 61.91%、statements 72.07%，ratchet 通过。最终 typecheck、lint、check:gates、diff whitespace 检查通过，AgentOrchestrator façade 799 行（<800）。最后代码重新构建后 canonical 桌面入口成功初始化；本轮桌面 PID 41092 及子进程已停止，锁 owner 已确认死亡，无 QA/desktop launcher 残留。桌面启动权已交还。

实际结果保存补证 `result-persistence-proof.json`：新完成子执行全文 8203 字节，父通知 2479 字节，outputs 超限部分外置；通知引用与真实文件 SHA-256 相同，文件保存时间早于通知。协议配对、原图字节校验、两遍分页重建与本条测试数字均为可复查证据；未将模型自述或 UI 成功当作原生实验成立。

## 2026-09-11 Settings / Knowledge 现代化重设计

实现提交 `032f819`。上表只把实际跑过的三项标为 verified：八项导航、知识包导出再导入、弹层 Escape 分层。门禁侧 `typecheck` / `lint` / `check:gates` / coverage ratchet / `build` 已通过；disposable Browser QA 后 `instance.lock` 不存在，桌面启动权已交还。

本轮明确没有当作已验收的部分：

- 参考图 T03 / H03 / T04 / T05 / A04 / K04 / K05 / K06 / K12 保留现有字段与实现，只跟着共享组件和 CSS 重整，没有按图重排版式。
- 明暗主题切换、英文 locale、640px 全屏没有逐面板走查。
- 颜色选择器拖拽受 Browser QA 坐标系限制，改用 HSV 几何单测覆盖往返与色域/色相映射。
- 参考图橙色 `#cc7d5e` 是 Absoluty 预设，不是产品默认；默认仍是蓝色 `#33d1ff`。Absoluty / Codex / GitHub 预设原样保留。

## Settings／Knowledge／Composer 发布后待验收项（2026-09-12）

本轮提交包含已有视觉与运行修复及组件职责收敛；代码检查通过不等于 49 面板视觉验收通过。以下待办随本节所在提交发布，不沿用历史 verified 结论。


本轮工程验证：typecheck、lint、design-tokens、renderer-structure、fidelity、appearance、settings-agents、knowledge-system、provider-system、hooks、legacy-residue、repository-hygiene、check:gates、build 通过。完整 tests 与 coverage 使用 --maxWorkers=4 复跑，2676 passed / 4 skipped，coverage ratchet 通过；默认并发初跑超时，未调整测试阈值或断言。后续发布不自动关闭以上待办。

## 2026-09-13 Session Capture 内嵌回放升级

本轮在当前分支实施，未提交、未推送。Agent 基线 `b046757f21161b60935abc3da0747048d6e51075`，Tools 基线 `6bc341a1dd8718afcfd50cb052829feb311e83fb`；基线不是未提交修改的验收身份。Tools 原有 `.qoder/repowiki` 修改保留。本机执行计划、Tasks 和最小运行回执位于 `.local/replay-upgrade/`；下列记录保留实际失败与复验边界。

- 已实测 Local：通过 disposable Browser QA 连接真实 Electron main、IPC 和原生 CLI；Open 自动选择真实 Present EID 14，输出 603×653 画面。EID 5 没有颜色输出，EID 6 为清屏，连续拖动回到 EID 14 恢复立方体；依据不同画面而非按钮文案判断 apply 成功。capture 完整 SHA-256 为 `00797a27e6316a0cf4369327f9db30a21635fa757673b3f9712af07989145ba8`。原生 smoke 图片用于回放验收，不是 GPU 科学实验的效果证据。
- 已实测隔离与输入生命周期：同一 RDC 在 A/B 两个 session 中使用不同 context UUID；关闭 B 不关闭 A。改变选择进入待切换，取消保留原绑定，应用切换先关闭旧 context。删除一个同内容输入时，另一个输入的活跃回放保留；删除最后一个输入后，其关联 context 释放、实时图片清空，原有 Capture 空态恢复，不保留新 Tab／滑条／选择器。
- 已实测 UI：中文／英文、深色／浅色、默认右栏、窄屏 drawer、长文件名、事件输入 Enter、滑条 Home／End、Tab 左右键、drawer Escape。900×700 viewport 请求下实际 CSS 宽度 818，Capture clientWidth 与 scrollWidth 均为 397，没有横向溢出。重启恢复选择资料，没有自动打开或占用设备。
- 性能小样本：原生 PerformanceObserver Event Timing（16 ms 采集阈值）六个非零 interactionId，p95 为 24 ms，Long Task 为 0；一次 EID 6→14 的请求到 applying 投影约 12.1 ms，到新图片可见约 380.9 ms。该样本不能代表全部设备、capture 或持续拖动分布；原生 apply 与导出在一个串行回执中，未独立测量 GPU／网络分段，不把工具往返时间当作交互性能。
- 第一轮完整验证：380 个测试文件通过、4 跳过，2733 项测试通过、4 跳过；coverage lines 74.8%、functions 76.6%、branches 62.03%、statements 72.41%，ratchet 通过。typecheck、lint、check:gates 和 build 通过。Tools 后续完整 Python suite 268 通过，Markdown/catalog 25 文件检查通过。后续完整性修复需以新的验证记录覆盖其受影响范围。
- 发现并修复后复验：共享设备预留空隙、生命周期与 Agent preparation 竞争、迟到 open generation、观察失败误用旧 EID、清理失败阻止空输入投影、历史组件跨 scope 引用、右栏不能滚动、无输出事件永久 applying、手动 Present 事件不能取得最终画面。完整性审查另指出真实传输进度、修改状态／原生 revision 写入和局部失败状态尚需补齐；执行 Tasks 记录修复与独立复验，不以此前绿色结果冒充最终通过。
- Android 边界：设备 `e38b8019` 可见，已有用户的 RenderDoc helper 正在运行。本轮未重启或停止该 helper。现有绑定的客户端 RemoteServer 没有可确认设备画面呈现的接口，不能用应用内 PNG 或 Win32 输出窗口替代 Android 屏幕验收。Android 呈现保持 `blocked / TODO(UNVERIFIED)`。
- 模型边界：隔离 QA 未配置 provider；使用现有模型凭据的询问尚未获答复，未复制凭据。Debugger／Analyzer／Optimizer 的真实模型执行、同 EID 修改／恢复与足迹联动保持 `TODO(UNVERIFIED)`；受控测试和持久记录读取不能代替这项证明。

最终修复与验收补证：

- 完整性遗漏已修复并独立复查：原生真实传输回执贯通；revision／修改状态／显示参数写入；失败事实使用未知 EID 且不附旧图；Agent 图片与其操作信息成对投影，手动帧回放不覆盖；错误、最终目标警告和设备呈现不完整均显示局部就绪；main 为每次操作分配独立 operationId，并在同次阶段和结果中保持相关性。独立冻结源码复查 54 项测试通过，在该修复范围内无剩余可操作发现。
- Android 生命周期收敛：启动前检查两种架构的 helper，查询失败时拒绝继续；移除无条件启动前 force-stop；清理时核对记录的自有 PID 集合。真机只读检查前后均为 arm32 无 PID、arm64 PID 29255，未安装、推配置、启停进程或建立转发。它证明占用识别和保护边界，不证明 Remote 打开或设备显示。
- 最终构建再次实测 Local Open→EID 5 无输出→EID 6 清屏→EID 14 最终画面→Close。EID 5 卡头显示局部就绪，没有错误重试入口；Close 期间保留画面，确认释放后清除。实际投影包含原生 revision、baseline 状态和 main operationId。
- 历史读取使用明确标注的受控持久样本，经真实 main IPC 在重启后读取：默认选择最近成功步骤，支持 14→11→未知 EID 的提交顺序，失败步骤无图片，播放到末尾停止；回看时 context 仍为空。打开后手动 apply EID 6，历史仍显示匹配其操作的 EID 11 图像。该样本没有生成假的 Agent 调用、实验修改或消息证据。
- 最终完整应用验证：381 个文件通过、4 跳过，2749 项测试通过、4 跳过；coverage lines 74.83%、functions 76.59%、branches 62.07%、statements 72.44%，ratchet 通过。与构建／门禁并行的上一轮出现三个既有 Investigation 测试 5 秒超时；重负载结束后以 `--maxWorkers=2` 完整复跑通过，没有修改测试阈值或断言。最终 typecheck、lint、check:gates 和 build 均通过。主 agent 独立重跑最终 Tools 完整 suite：275 通过，20.20 秒。
- 未提交源码身份：Agent `0d0eaa8027ce60109ae1774746bc142ba232f19f98daae7b038b4b4b3ebf34c0`，Tools `0c9b8aa66cdac3d1fc41765d156e3ea324b36aa61497e390b4ad52acaa6dfb85`。算法为排序后的 Git tracked 与非忽略 untracked 文件路径、NUL、内容 SHA-256、LF 所组成记录的 SHA-256；删除文件用 `DELETED`，符号链接用其链接文本；排除受保护的 `.qoder/` 和本验收文档以避免回执自引用。具体基线和文件数记录于本机 `source-identity.json`。
- 正式 `scripts/start-rdc-agent.cmd` 使用本轮临时 userData 实际启动，加载最终 `file://` renderer，未出现占锁失败。QA owner 129936、desktop owner 133808 及自有子进程均已停止；原有 canonical lock owner 17064 已死且未被修改。没有停止用户的其他进程。桌面启动权已交还。

完整计划仍不宣称全绿：Android Remote／设备呈现和真实 provider 的 Agent 执行保持上述 `blocked / TODO(UNVERIFIED)`；代码、受控测试、真实 Local 与历史读取各自按实际证据成立。磁盘清理回执在本机 `cleanup-receipt.json` 中记录最终检查结果。

最终收口：仅移除 ResizeHandle.css 文件末尾多余空行后重新 build 通过，两库 git diff --check 通过；上述源码指纹已按最终文件重新计算。本轮临时 QA 项目、capture 副本、测试目录和自有 context 残留已清理，保留最小验收日志与回执。桌面启动权已交还。Android 与真实 provider 验收阻塞保持不变。

## 2026-09-13 Tools 操作收敛与应用固定对接

本轮在当前分支实施，未提交或推送。Tools 基线 `7f5b085b999641977863f91cdb984e667db36629`，Agent 基线 `d2aecfad274552b7a1e2df8ad9076af5998120a4`。执行状态沿用 Tools 仓库的 `docs/tool-convergence-tasks.md`；以下只记本轮已验证事实，不借用前轮绿色结果。

- Tools 定义、注册与生成目录为 124 个操作，移除名称不再执行；工具版本 2.0.0，canonical envelope 保持 3.0.0。完整 Python 测试 286 项通过；后续耗时修复的 5 项定向测试独立通过，覆盖全事件返回、数值枚举、秒到微秒换算与非法数据拒绝。source gate 与显式发行包检查已分开，两个新增分支独立验证通过；未生成发行包。
- 真实小 fixture 验证了管线目标、绑定格式、OBJ 几何、纹理统计不落盘、像素历史、Present 原子观察以及关闭/重开。独立 preview 实测 on、事件切换、off 与专有 daemon 清理通过；没有目视原生窗口，不将协议状态扩大为视觉验收。
- 应用固定对接的版本、catalog 指纹、身份、取消、关闭失败恢复、冻结配置与 Settings 安装状态测试独立通过；生产 argv 的 7 个固定操作、9 个本地/远端/观察变体通过实际 Tools schema 校验。
- Android 外部边界：设备 `e38b8019` 在线，一次 connect 返回 `android_helper_occupied`。当时仅检测到 helper 进程，未确认服务被其他会话占用；未重启、未上传 WhiteHair，ping/open_replay/observe 与设备呈现尚未验证。测试自有 daemon 已停止。
- 真实设置只移除了 tooling.rdxActions、tooling.rdxCli.catalogPath 和 tooling.rdxCli.jsonMode；逐项比较确认其他解析内容不变，配置的 CLI 能返回 schema 1 的 124 项目录。真实 Settings 页面显示可用 2.0.0 / 124 个操作；空 executable 禁用验证、未保存配置提示、深浅主题和 800×700 请求视口的窄窗口表单均经过实际点击检查。已恢复原深色主题，最终比较确认其他设置完全一致，恢复备份已删除。
- 能力权限和五阶段证据的独立定向检查 60 项通过；三个 Mission 的 requiredSkillIds 交接、General 实际 preload 和可见性检查 59 项通过，四本 Skill 和生成参考校验通过。完整应用测试 2792 项通过、3 项条件跳过；coverage ratchet 通过（lines 74.84%、functions 76.61%、branches 62.12%、statements 72.43%），类型、lint、工程门禁和构建通过。首次完整检查揭示的 schema 互斥定义及 Settings 分层/退役生成基线已修复，只复验直接受影响范围。
- 大 capture 直接读取 `D:/Projects/agentTest/rdc/.rdx/inputs/眼睛泪腺白点.rdc`，没有复制。真实应用打开最初暴露 native 成功结果缺 context 身份；三个生命周期结果现返回真实身份，应用校验没有放宽。修复后打开、1650 项完整事件索引、EID7388 导航、观察、context 查询、正常关闭与新 context 重新打开通过。requested/applied/image EID 均为 7388，目标为 ResourceId::2002006、slot0，真实画面已目视；窄窗口 Capture 抽屉滚动和控件可达性通过。该 capture 没有可唯一确认的最终 swap-buffer，默认 EID147 无颜色输出，页面如实保留部分就绪及无图事实。
- 真实 Provider 边界：该真实设置启动后报告 hasConfiguredProvider=false，Composer 没有可选模型，未执行模型请求。真实三个 Mission 消费手册的效果仍未验证，确定性加载链不是模型效果证明。
- 最终独立真实 GPU 签名 A-B-A 通过（1 项，16 秒）：真实 baseline 像素、shader intervention、不同像素的 variant、真实 replacement 回滚、baseline hash 恢复，以及主进程签发的五阶段回执均验证通过。正式桌面启动脚本复用现有构建启动成功，窗口标题为 RdcAgent - RenderDoc Debug Agent；本轮自有桌面实例已停止。外部 Android 与真实 Provider 边界保持上述未验证状态。
- 最终清理完成：统一临时根 `Tools/intermediate/tool-convergence-tests`、本轮专属回放 `D:/Projects/agentTest/rdc/.rdx/replay/sess_0cf7f31df1db`、真实设置备份、临时 coverage junction、图像/导出和精确自有 context 残留均已移除。测试目录不同执行身份的 ACL 已分别处理，最终删除无错误且两个根目录均不存在；没有沿链接删除。真实输入、既有回放、用户记录、依赖与当前构建均保留。
- QA、桌面验证实例及自有子进程已停止；一个自有查询 daemon 正常停止超时后，按已确认 context 和 PID 清理并确认消失。应用正常关闭/重新打开的通过证据独立保留。canonical 桌面锁不存在，桌面启动权已交还。最终两库差异空白检查与 Tools Markdown 27 文件检查通过。
- Task 已更新：T01–T07 通过；T08 的本地验收和清理通过，仅 Android helper 占用与无真实 Provider 仍为外部阻塞。无剩余本地代码、文档或清理任务；不将未验证的远端及真实模型效果声明为完成。

用户后续要求取消版本分代设定：撤回 Tools 发布号升级，删除应用的 2.x major 门槛及专业手册 toolsContractVersion 绑定。接入依据实际 JSON 格式、catalog 指纹、操作参数和能力；包元数据仅用于诊断。此前 2.0.0 的 UI 记录是当时实测值，不是当前接入要求。定向应用测试 20 项、Tools 文档及 CLI 测试 6 项通过；生成手册新鲜度、类型、lint、构建及差异空白检查通过。本次未启动 QA/Electron，未新增临时测试目录。

## 2026-09-14 Android 连接与 Mission 确定性收敛

执行状态继续使用 Tools/docs/tool-convergence-tasks.md。此前“helper 属于其他用户会话”的推断已撤回；真实模型效果由用户明确安排到后续 debug loop，不再阻塞本轮软件验收。

- Android 设备选择不再提前触发没有 owning context 的连接；Capture 打开后使用冻结 CLI 配置和所属 context 激活设备。移除无法正确拥有会话的 device:activate IPC；应用不实现独立 helper 启停。已连接状态区分启动和借用，不再凭包名宣称 APK 已验证。
- Tools 连接已有服务时不安装、推送配置、启动或停止它；连接与 Ping 成功才返回句柄。真实测试发现 open_replay 第二次创建 native connection 会报告服务忙，现复用所属连接。clear_context 先完成所属会话与远端清理，再清除身份；失败保留恢复信息。CLI 原始错误码和消息保留到应用错误投影。
- Debugger、Analyzer、Optimizer 参数化覆盖 Plan/hash、requiredSkillIds、真实内置内容预载、受控执行交接、返回原 Mission；通用篡改、跨会话、权限及冻结负路径复用既有测试。49 项相关测试通过；设备/会话 29 项、native 协议/调用/会话 46 项通过，组间存在重叠，不相加。生成专业参考、Skill 校验、类型、lint、工程门禁和最新桌面构建通过。受控结果不代表真实模型判断成功。
- 用户无需手动打开 Command。设备最初没有 helper，正常 connect 自动启动通过；随后由测试夹具启动一个本轮自有 helper，CLI 借用、Ping、断开、再连接均通过，借用期间保留该 helper 与原有转发。这验证了复用行为，但不宣称现场存在真实用户预启动进程。
- 实际设备/Capture 页面打开 WhiteHair，成功传输一次、取得 1178 个事件，首次 EID3029 图像成功并目视。EID3027 无颜色输出；返回 EID3029 后 SaveTexture 返回 29/DataNotAvailable，图像重试再次失败。requested/applied 为 3029，imageEventId 为 null，目标 ResourceId::148783。未认定驱动、服务端或应用根因。T08-D 保持阻塞，不能以首次 PNG 成功替代完整事件导航验收。设备呈现仍为 unsupported。
- 实际检查设备选择、打开中的禁用状态、错误/重试和 960 像素宽 Capture 抽屉。最新正式桌面构建启动后窗口标题及非零窗口句柄符合预期；原生窗口存在与 Browser 目视证据分别记录。此前未受影响的全量和本地 GPU 验收保留，不重复上传或重跑。

本轮清理已验证：四个专用 CLI daemon 正常停止，QA/桌面自有进程消失；精确归属的转发与测试 helper 清理无错误，最终 ADB 转发和 helper 查询为空。唯一临时根 intermediate/android-convergence 与本轮 replay/sess_e08b0465e44a 已删除；不同 ACL 使用对应身份处理，未沿链接或修改仓库权限。浏览器 QA 标签已关闭、视口恢复，正常桌面启动权已交还。保留真实输入、用户历史、既有回放、当前依赖、Android 安装和应用构建。两库差异空白检查与 Tools 文档检查通过；T08-A/B/C/E 通过，T08-D 因上述真实重复观察失败保持阻塞。


## Necessary-capability restoration acceptance

Execution status remains in Tools/docs/tool-convergence-tasks.md. Capture identity, temporary replay restoration proof and complete-replay measurement evidence are implemented at the frozen CLI/serial lease boundary. Shared and three specialist manuals and generated references use the current definitions; no operation count or namespace whitelist grants permission.

Agent full run: 2815 passed, eight failed. Two empty-stdout process failures were incorrectly classified as malformed protocol and were repaired without accepting noncanonical success. Six process/file tests timed out under full concurrency; their original assertions and timeout values passed with two workers. All eight affected files passed (70 tests). Typecheck, lint, guide freshness, engineering gates and application build passed; the subsequent native-error classification change received its direct protocol/session regression.

Isolated Browser QA copied only required current configuration, encrypted secrets under the same OS identity, scoped resources and one 65913-byte capture fixture. Actual Capture open, Present21 → draw15 → no-color17 → draw15, close/reopen and final close passed. At 900×760 the drawer scrolls to Capture controls and Composer remains usable. Progress/Artifacts/output empty states and actual context resources were inspected. During General execution replay controls were disabled and restored afterward.

ClinePass DeepSeek V4 Flash used exactly two recorded Provider requests: one actual shell.rdx pipeline query and one result continuation. The query returned one populated color target, a preserved empty slot and separate depth target; visible replay remained EID15. This is one bounded General integration test, not proof of three Missions' real model reasoning quality. Their deterministic software-chain evidence remains separate.

Android matching-runtime acceptance now passed: Android Studio SDK NDK 27.3.13750724/CMake 3.31.6 built both architectures, and the deployed arm64 service connected. The first native failure was a five-second idle packet receive timeout; polling for a new packet fixes idle disconnect while retaining the partial-packet deadline. CLI and actual Capture UI both passed EID3029 → no-color3027 → EID3029 with fresh 1552×720 images. UI close/reopen returned to EID3029; at 900×760 the drawer exposes image, navigation and close controls. A wrong local-backend selection showed the actual unsupported Vulkan-extension error and recovered through close and device selection. Device presentation remains unsupported. The verified device capture was reused without repeated uploads. No further Provider request was made (2/6 total). Final QA/process cleanup passed: Browser tab/viewport released, own Electron instance and task daemons stopped, device sample/forwards released, isolated configuration/secrets and temporary roots removed. Current builds and installed SDK dependencies remain. Canonical desktop lock is absent; older contexts outside proven task ownership were preserved. Exact results remain in the Tools task ledger.

## 2026-09-14 Plan/Handoff 完整链路收敛

本节对应当前未提交工作区，非历史 verified SHA。保留上方前轮来源；表中 planned 不代表本节工程用例未执行，而是尚无可绑定的提交。真实模型完整链路仍未通过。

- T0：对照桌面需求、原计划与本轮批准计划，保留原 Agent 的功能范围；.qoder 等无关工作未修改。
- T1：根/子任务计划审阅与普通审批分离；按真实 owner 路由；批准先冻结并持久化，之后发布内存授权；新周期撤销旧授权；执行核对 target/hash/frozen URI。冻结与写入失败、错误 owner/target、取消和重复回答保持拒绝。
- T2：历史读取/导出/项目保存绑定持久 tool call 的 planId/revision/owner/Agent/URI/hash，覆盖嵌套 work block；无可信来源明确失败。状态使用严格 Zod 与 StorageIo。导出由主进程保存对话框选路径；token 绑定动作、会话、owner、制品与路径，原子写入并验证，失败保留原文件。
- T3：建议行等待 Agent 切换成功并检查当前会话，Stop/重复点击/迟到回调不触发陈旧发送。计划卡独立按钮与折叠；现有语义 token 和共享 Button；390 窄屏保留分节滚动、版本与阅读入口。全文加载失败不展示伪正文，禁用写入/复制；成功写入和复制提供状态提示。Context 排除 session plans，通用资源提取仍保留原始证据。QA 同时修正 RDX CLI 环境与参数前缀逐字符输入丢失，复用已有原始文本草稿方式。
- T4：完整测试 396 文件通过、3 跳过，2853 用例通过、3 跳过；lines 74.94%、functions 76.76%、branches 62.11%、statements 72.55%，coverage ratchet 通过。两次并发运行的 Investigation 超时/嵌套检查退出失败，单独检查及单 worker 全量通过；没有改超时、断言或路径安全检查。Knowledge 在本轮专用 TEMP 正常通过。实际审阅服务驱动三个 Mission 的 Handoff fixture，不直接注入 approvedPlan；这只是确定性工程链路。最后 Browser 修正另做受影响回归，静态门禁与构建结果按最终补证。
- T5 Browser：标准 launcher、一次性同源 /app、隔离 userData/home，复制必要配置、加密凭据及其 Local State；移除的旧 Agent 覆盖只在隔离副本中。project qa-plan-handoff / session sess_441e6b119be5，Debugger 真实提交计划 plan-807e7a086ab8，v1 拒绝后同一链路生成 v2，批准后冻结 hash a407f813750947ab10e3befe4e2bb25d7a4d1152b6aeebed90cbf989bfc6d9af。切换 General 后保存 v2，frontmatter 仍为 debugger，hash/owner 正确；v1 保存发生在修订前。390×844、独立折叠、全文读取、Esc 回到打开按钮、保存/复制成功提示、正文缺失 PLAN_NOT_FOUND 与三个操作禁用已观察。切换空 Capture 会话后五栏回到该会话空态；返回计划会话 Context 仅保留实际 Skill，无 live/frozen plan。
- T5 模型：ClinePass DeepSeek V4 Flash，8 次 provider 请求，每次输出上限 1500，累计输出上界 12000；第 9 次在发送前由临时预算守卫拒绝。批准后模型误调用 background_query，被 ownership 检查拒绝，随后找到 agent_handoff，但预算已尽。真实 General execute/原 Mission 回评估以及由其生成的建议行未完成；不得把 fixture 或人工切换 Agent 算作模型交接通过。
- T5 原生对话框：当前内置浏览器控制面不能操作 Electron 原生保存对话框；导出选路/取消/替换/重放/失败保留原文件由主进程集成测试覆盖，未把原生导出点击链标为 Browser 通过。Android WhiteHair 因无设备未实测。

最终补证：

- 源码识别：基线 HEAD 44f67a8e2cfe8e4ae2b8871db82cbed175449fa0，加当前未提交修改。对 rg --files src resources scripts designs 排序，逐项以路径（斜线归一化）、NUL、原始字节、NUL 累积 SHA-256；2217 个文件的指纹为 a6705a4407b5e022e568e52e6a53034ce2e130e0c8524a3d42c1a07db41815d8。这是工作区指纹，不是 verified commit。
- 最后修改的 5 个相关测试文件共 22 个唯一用例通过；最终 typecheck、lint、check:gates 和 build 全部通过。contracts/resources/project-instructions/prompt/skills/hooks/memory 的测试集合已包含在前述完整测试，不重复调用同一集合。
- 最新 Browser 表单逐字符输入 QA_DRAFT（尚无等号）以及 one two 后的空格均保留，随后恢复草稿，未保存诊断参数。
- Capture：隔离配置继承 RDX disabled，配置现有 CLI 后安装校验识别 128 operations。默认 Tools runtime 根返回 context_limit_exceeded；该尝试创建了本轮 daemon/log metadata，关闭未得到原生确认，UI 保留 RDX_CLOSE_FAILED 和 ownership，不能算关闭成功。随后用官方 RDX_INTERMEDIATE_ROOT 创建独立 runtime，新会话 sess_d9accc00c70f 原位打开本地 RDC（未复制）。capture SHA-256 为 0a79926a92e7e659989befc2322dc93b65782252fc5be2de33496142735a4094；真实事件 147→140→137→147 均得到 Applied EID，最终 Close 返回 Not open。Present 回执为 Final Present does not identify exactly one swap-buffer resource，三个事件均无图像，故这里只通过事件选择/恢复/隔离关闭，图像预览没有通过。无 Android 设备，不尝试 WhiteHair。原项目 metadata SHA-256 前后一致 f367755908a593cad88bddcff675573c3b4a7b725601bcf5264609af76acdcc5。
- T6 清理完成：Browser 尺寸恢复、QA 页面关闭，launcher 退出；QA 锁持有 PID 42288 已退出，canonical 桌面 instance.lock 不存在，桌面启动权已交还。隔离 RDX daemon 随应用退出，默认根本轮失败上下文通过官方 daemon stop 停止（PID 66924 已退出），仅删除该上下文的残留日志，其他上下文保留。清理了本轮 .local（QA project/userData/home、加密凭据副本、运行时、预算守卫、工作清单、专用测试 TEMP）及 coverage 中间报告；保留当前 out 构建与依赖。加密副本因 ACL 首次删除失败，提升权限删除后再次复查。未复制或删除原始 capture、真实会话与用户资源。清理回执不代表未完成的模型、图像或设备验收通过。

### 2026-09-14 续接范围调整

按用户最新决定，General 执行与 Mission 回评估，以及依赖此链路的真实模型建议行验收，交由后续专门大项验证；不再作为本次家中续接任务或阻塞。上述历史未完成事实保持，不改标为通过。本次续接仅保留原生导出对话框、本地与 Android Capture 验收，详见 docs/workflows/plan-handoff-acceptance-continuation.md。
