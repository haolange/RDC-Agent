# Acceptance Ledger

Verifier 结论落盘。本文件是二次收敛（U00–U07）与 T18 现场取证的验收台账，不是第二产品权威；产品裁决以根目录 [`DESIGN.md`](../../DESIGN.md) 为准。

**Browser 证据路径在仓库外** `%LOCALAPPDATA%/rdc-agent-qa/<sha>/`。条目若引用 Browser 证据，只记相对该目录的路径、build SHA、QA `projectId` / `sessionId`、viewport、theme/motion、DOM selector、IPC channel + 结果码。**禁止**写入 token / cookie / secret / qaBootstrap。

`pnpm run check:acceptance-ledger` 由 **U04** 落地并接入 CI。U00 只建表，不假装门禁已绿。

Verdict 枚举：`planned` / `verified` / `failed` / `waived-by-user`。`verified` 行的 Commit SHA 必须是真实 git 对象；没有独立 commit 时写 `—`，不得伪造。

| Task | Criterion | Gate/Test | Browser evidence ref | Verdict | Commit SHA | Date |
| --- | --- | --- | --- | --- | --- | --- |
| U00-topology | DESIGN / AGENTS / docs 跨文档拓扑一致：四 builtin 唯一；ask/plan/edit 非法 id + 无 custom manifest 运行通道 | 人工对照 `DESIGN.md` 裁决 A；U04 `check:acceptance-ledger` 短语断言 | — | verified | fbf5d639 | 2026-09-05 |
| U00-six-lanes | Knowledge 目标拓扑为六 lane（Identity/Path、Scope/Metadata、Lexical、Structural、Relation/Graph、Temporal/Version）；Embedding / Semantic 不是现行合同 | 人工对照 `DESIGN.md` 裁决 C / G | — | verified | fbf5d639 | 2026-09-05 |
| U00-read-roots | canonical knowledge 读根合同已写入：`realpath(~/.rdx/knowledge)` + `realpath(<projectRoot>/.rdx/knowledge)` 仅对 `read_file`/`read_image`/`glob`/`grep` 免审批；write/edit/delete/shell/code_interpreter 双层拒绝。U02 改代码 | `docs/contracts/permissions.md`；`DESIGN.md` 裁决 G | — | verified | fbf5d639 | 2026-09-05 |
| U00-run-v3 | 文档现行合同为 Run schema v3；禁止再写「Run 当前仍为 v2」 | `DESIGN.md` 裁决 I；`docs/product/renderdoc-agent-complete-design.md` §3.7 / §22 | — | verified | fbf5d639 | 2026-09-05 |
| U00-investigation-read | IPC `investigation:read({ sessionId, artifactId, expectedHash })` 已落地；投影带完整 `contentHash`；禁止再写「无该 IPC」 | `DESIGN.md` 裁决 B / E；`docs/contracts/permissions.md` | — | verified | fbf5d639 | 2026-09-05 |
| U00-no-custom-manifest | 文档删除「用户保留的已改 ask/plan/edit 仍可按 custom manifest 运行」作为现行合同；目标态无运行通道（U01 改代码） | `DESIGN.md` 裁决 A；`docs/product/agent-manifest-models.md` | — | verified | fbf5d639 | 2026-09-05 |
| U00-ledger | 本文件已建；列正好为 Task / Criterion / Gate/Test / Browser evidence ref / Verdict / Commit SHA / Date | 本文件存在；U04 才接 `check:acceptance-ledger` | — | verified | fbf5d639 | 2026-09-05 |
| U00-hygiene | `pnpm run check:repository-hygiene` 绿 | `pnpm run check:repository-hygiene` | — | verified | fbf5d639 | 2026-09-05 |
| U01-canonical-hash | `hashCanonicalAgentSemantics` 只排除顶层 `models`/`icon`/`accent` 与 `handoffs[*].model` | U01 字段级测试；`check:settings-agents` | — | planned | — | — |
| U01-v2-marker | seed 迁移 marker `schemaVersion:'2'`；v1 视为未完成并重跑；更高版本 fail-closed | U01 purge/keep 矩阵 | — | planned | — | — |
| U01-crash-recovery | 隔离前写 isolation manifest；未完成事务可恢复或 fail-closed，不静默丢文件 | U01 崩溃恢复测试 | — | planned | — | — |
| U01-purge-keep | 历史 id `purged-historical`；shadow `purged-shadow`；改过正文/工具的 builtin-id `retained-override`；无关 id `retained-custom` | U01 purge/keep 矩阵 | — | planned | — | — |
| U01-illegal-id | user/project 非法 id 剔出 effective snapshot + `AGENT_ID_RESERVED_HISTORICAL`；无 custom manifest 运行通道 | `check:settings-agents` | U01 Browser QA：Settings / Composer 恰为 4 | planned | — | — |
| U02-delete-embedding | 逐文件删除 EmbeddingCatalog / EmbeddingExecutionService / Semantic lane / `settings.llm.embedding`；禁止恢复 | U02 `check:knowledge-system` `forbidden.embedding-runtime`；`check:provider-catalog` | — | planned | — | — |
| U02-six-lanes-code | Knowledge 源码与门禁收敛为六 lane；不再把 Semantic hits 当现行门禁 | U02 `check:knowledge-system` `lanes.six` | U02 Knowledge Center 无 Semantic 状态 | planned | — | — |
| U02-read-roots-code | `knowledgeReadRoots` 冻结并仅注入四只读文件工具；写工具双层拒绝 | U02 permissions / EffectiveRuntimePlan 测试 | U02 debugger `grep ~/.rdx/knowledge` 无审批 | planned | — | — |
| U02-settings-7 | Settings schema 6→7 一次性删除 `llm.embedding`；>7 fail-closed | U02 settings 迁移 fixture | Settings > Models 无 Embedding 区 | planned | — | — |
| U03-mcp-legacy | `MCPManager` legacy sanitized fallback：删除或证明 in-flight 必需并补 TTL/测试 | U03 `check:legacy-residue` | — | planned | — | — |
| U03-modes | `modes.ts` `MODE_CAPABILITIES`：只被测试用则删，否则改为真值 | `modes.test.ts`；U03 `check:legacy-residue` | — | planned | — | — |
| U03-dead-types | 删除 dead `WriteScope` / `IntakeContext` / `GateResult` | U03 `check:legacy-residue` | — | planned | — | — |
| U03-timeline-type | `AgentTimelineEntry.type` 收窄到实际发出的值 | U03 `check:legacy-residue` | — | planned | — | — |
| U03-coordination-mode | `coordinationMode` → `turn_handoff`（shared/main/renderer/测试同步） | U03 `check:legacy-residue` | — | planned | — | — |
| U03-plan-phases | `check-investigation-system` 过时 `PLAN_PHASES` 改为当前 phase 合同 | `pnpm run check:investigation-system` | — | planned | — | — |
| U03-rdx-leak | 删除 `rdx-runtime-leak.json` 写入；改 runtimeLog + `ProcessSupervisor unconfirmed_orphan` | U03 `check:legacy-residue` | — | planned | — | — |
| U03-harness | `harness.ts` **不改名**，只确认只剩 `ArtifactKind` / `ArtifactRecord` | U03 `check:legacy-residue` | — | planned | — | — |
| U03-legacy-residue | `check:legacy-residue` 零命中（合法词精确上下文白名单） | U03 落地 `pnpm run check:legacy-residue` | — | planned | — | — |
| U04-gates | CI build job 改为 `pnpm run check:gates` 聚合 | `.github/workflows/ci.yml`；本地 `check:gates` | — | planned | — | — |
| U04-diff-check | CI 增加 `git diff --check`（有效 base 解析） | U04 脚本 + 首提交测试 | — | planned | — | — |
| U04-ledger-gate | `check:acceptance-ledger` schema + verified SHA ∈ `git rev-list HEAD`；文档 required/forbidden 短语断言 | `pnpm run check:acceptance-ledger` | — | planned | — | — |
| U05-browser-matrix | 产品级 Browser QA 全矩阵（1440×900 / 390×844；Light/Dark/reduced-motion；Workbench / Project / Session / Settings 九节 / Knowledge Center / 五卡 / Composer 五底栏 / fail-closed / qaPerformance） | `start:agent-browser` + luna 审 ledger 条目完整性 | `%LOCALAPPDATA%/rdc-agent-qa/<sha>/`（U05 填写） | planned | — | — |
| U06-t15-completed | T15 Debugger + WhiteHair（Android adb）正常 `completed`：checkpoint + ready report + `final_answer` 引用；负路径复验 | U06 机器校验 `run.json` schemaVersion `'3'` + investigation index | U06 填写；设备 id/serial | planned | — | — |
| U06-t16-completed | T16 Analyzer + 中文 1.57GB capture：Observed/Reconstructed/Authoring 三层 claim + ready report complete | U06 机器校验 | U06 填写 | planned | — | — |
| U06-t17-completed | T17 Optimizer：A-B-A Experiment `rolled_back` + rollback 三条件 + 工程 hash 前后一致 + ready report complete | U06 机器校验 | U06 填写 | planned | — | — |
| U07-release | 全量门禁 + coverage + build + pack；ledger 零 `planned`；`HEAD == origin/main`；交还 `instance.lock` | `check:gates` / `test:coverage` / `check:coverage-ratchet` / `build` / `pack` / `check:acceptance-ledger` | — | planned | — | — |
| T18-colddata-draft | ColdData → session Draft：`knowledge:coldDataImport` 两份桌面案例；`candidateCreated: false`；`sourceStatus: fixed`；`verified: false`；再导入 `conflict` | T18 canonical Browser QA | 仓库外 QA 记录；见 `DESIGN.md` T18 已证组 | verified | b68e4f29 | 2026-09-03 |
| T18-colddata-source | ColdData 源不变：`BugFull案例01.txt` SHA256 `b3885f07…c381d0`；`BugFull案例02.txt` `bfa12c54…7e35e5`；与 Draft `sourceHash` 一致 | T18 源 hash 复核 | 见 `DESIGN.md` T18 已证组 | verified | b68e4f29 | 2026-09-03 |
| T18-colddata-userspace | user-space 持久化：`~/.rdx/knowledge/cases/AIRD-20260207-000{1,2}.md`；index `cardCount: 2`；Center User space 2；中文标题完整；`knowledge:query` 词法命中「发黑」 | T18 Center + query | 见 `DESIGN.md` T18 已证组 | verified | b68e4f29 | 2026-09-03 |
| T18-chinese-capture-open | 中文 1.57GB capture open+preview：`眼睛泪腺白点.rdc` SHA256 `0A79926A92E7E659989BEFC2322DC93B65782252FC5BE2DE33496142735A4094`；size `1647684424`；`openProjectInput` `status: open`；`openHumanPreview` `success`；hash 2026-09-04 复测仍不变 | T18 Capture open/preview | 见 `DESIGN.md` T18 已证组 | verified | b68e4f29 | 2026-09-03 |
| T18-t15-debugger-neg | T15 Debugger 负路径：无 capture `sess_df6be27d58a5` → `MISSION_COMPLETION_DENIED`（缺 MissionCheckpoint），未伪装 completed。Settings RDX CLI 已配置；未配置 fail-closed 单测在 `adafa804` | `adafa804` 单测 + T18 session 证据摘要 | `sess_df6be27d58a5` | verified | adafa804 | 2026-09-03 |
| T18-t16-analyzer-blocked | T16 Analyzer Blocked 诚实收口：`sess_5be2b0c52a58` / `proj_a99a24c68de3`；ready report `invart-55a27b669134-1788459010567`（`sha256:3fc09696feae39145fd4c94c66c9260dda460f1da610e0d618789328aba4c5e3`）；`reportContract.status=Blocked` → `MISSION_COMPLETION_DENIED`；`cl_t16` 仍 draft；伴随 `a37c107e` | T16 文档取证 | `sess_5be2b0c52a58` | verified | 215741da | 2026-09-03 |
| T18-t17-optimizer-blocked | T17 Optimizer Blocked 诚实收口：`sess_a73c57d0d2a5` / `proj_a99a24c68de3`；ready report `invart-71244190ba45-1788459648111`（`sha256:335d77de70a9a196f150330f7ae703366dd240b6723c9714e57eb6bc4ab10bbd`，`reportContract.status=Blocked`）→ `MISSION_COMPLETION_DENIED`；未写 Experiment / 未 mutate 工程。无独立 commit | T18 session 证据摘要 | `sess_a73c57d0d2a5` | verified | — | 2026-09-03 |
| T18-semantic | Semantic / 真实 OpenAI embed：`openai` `hasSecret: false`；lane `unavailable/unconfigured`；未伪装 ready。将由 U02 删除 Embedding / Semantic，**不再补跑**真实 OpenAI embed 验收 | U02 `forbidden.embedding-runtime` | — | planned | — | — |
| T18-whitehair-open | WhiteHair local open：`sess_17b59bc0131c` `openProjectInput(input_whitehair)` → `LOCAL_REPLAY_UNSUPPORTED`（Adreno 650 `VK_EXT_fragment_density_map` vs RTX 5090）；SHA256 `03DF08D14E6D5819E5173209D9AC1218C2F740010104EC911A7873E97A258D42`；size `168591424`。BLOCKED-by-device；正路径改 U06 Android adb。不得标 verified | T18 硬件诊断 | `sess_17b59bc0131c` | waived-by-user | — | 2026-09-03 |
