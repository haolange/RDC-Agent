# RDC-Agent Design and Architecture Guide

`DESIGN.md` 是本仓库**产品边界、架构原则、权威地图与核心不变量**的裁决文件。若 `README.md`、`AGENTS.md` 或 `docs/**` 与本文件冲突，以本文件为准并同步修正其它文档。详细契约、产品规格与 UI 规范已分拆到 `docs/`，本文件只保留裁决层与索引，避免根目录堆叠运行时细则。

## Product Boundary

RDC-Agent 是通用 agent workbench，并一等公民支持 RDC/RDX 与 RenderDoc `.rdc`。它应能作为日常 agent 工作台完成阅读、规划、编辑、搜索、工具调用、handoff、memory 与 subagent 编排，同时保留 capture 打开、replay 上下文、RDX actions、诊断与 RenderDoc 调查等垂直能力。

**发布面是 Windows-only。** `electron-builder.json` 只保留 `win`；mac/linux 安装包与公证不在产品范围内。POSIX launcher wrapper（`.sh`）仅供 Ubuntu CI 的 node 面准备，不是发布目标。Windows release 通道（`RDC_AGENT_RELEASE_CHANNEL=release` 或 git tag）必须提供 `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`（或 `CSC_*` 别名）；本地 `pnpm run pack` 保持不签名。SBOM 由完整 `pnpm-lock.yaml` 传递依赖图生成 CycloneDX，并记录 git SHA 与 lockfile digest。

**不做** image/video 生成 runtime、media provider 目录面或 `MediaRuntimeService` 类骨架；discovery 对非 agent modality（含 image/video output）保持 fail-closed 剔除。用户附件 vision-input（读图）仍属 agent chat 能力，与生成 media 无关。

产品不是固定模式向导。Ask、Plan、Edit、Debugger、Analyzer、Optimizer 是 agent profiles（指令、工具、审批策略、handoff、可见性不同）。仅 `user-invocable` 的 profile 出现在 composer orchestrator 菜单。Plan 不是硬编码 `AppMode`，而是可研究、提问、写 plan artifact、调用允许的 subagent 并 handoff 实现的 `.agent.md` profile。

唯一运行时路径是 agent loop：解析 profile / model route / policy / tools → 调用 LLM → 执行已批准工具 → 回灌结果 → 产出 final answer。Renderer 不得伪造推理阶段；隐藏 CoT 永不作为 UI 内容展示或持久化。

Agent loop 不能把“耗尽 turns”或“重复相同工具轮次”当作完成。`LoopProgressGuard` 对工具名、规范化参数、结果语义与 runtime revision 生成稳定指纹；连续第二轮无进展只注入一次不落盘纠偏指令，第三轮仍相同以 `AGENT_NO_PROGRESS` 终止。仍需 continuation 却达到 `maxTurns` 时以 `AGENT_MAX_TURNS_EXCEEDED` 终止。两者分别投影 `CONVERSATION_AGENT_LOOP_STALLED` / `CONVERSATION_AGENT_TURN_LIMIT_EXCEEDED`，不得归类成 Provider 请求失败。

## Architecture Principles

1. **单一真相**：Session / Conversation / branch / journal 是会话历史权威；Agent slot 是执行配置与缓存，不是私有历史。
2. **冻结执行**：`EffectiveRuntimePlan`（`schemaVersion: 3`，含 `planId` / fingerprint 与完整工具/策略面）在 `prepareTurn` 冻结；Prompt 与 Executor 共用；在途 turn 不读可变 Settings。
3. **主进程权威**：权限、secret、MCP trust、Shell、RDX CLI、IPC 校验均在 `src/main`；preload / renderer / Browser Bridge 只暴露受控面。
4. **Scope 固定**：用户资源 `~/.rdx`，项目资源 `<project-root>/.rdx`；无配置 workspace root、无旧目录 fallback、无静默迁移。
5. **Provider 事实分层**：Manifest 是**基线真值**（baseline truth），Discovery 是**候选验证**（candidate validation），用户覆盖（`models.json`）是**显式覆盖，自带 provenance**（explicit override with provenance），三者合并为 EffectiveCatalog。模型/协议/控件基线事实只在 `src/shared/provider-catalog/manifests` 的严格 JSON；TS 只实现 Schema、compiler、Registry、Resolver、Planner、adapter、auth、discovery 与 user-override。用户覆盖禁止触及 route.protocol、authSchemaId、adapterId、compatibilityGroup、carrier 等安全/延续性字段。
   `catalogRevision` 只冻结 Effective Catalog 的可执行/可选择语义；刷新仅更新 provenance 时间戳时 revision 必须稳定，route、control、availability、quota 等有效语义变化时才更新。
6. **可取消与可回收**：Turn 经 `TurnCoordinator`（Session ownership：Active → Aborting → Orphaned → Settled；Orphaned 时 `beginTurn` fail-closed `TURN_ORPHANED`；`abortAndJoin` 等 stream terminal **与** producerCompletion）。子进程经 `ProcessSupervisor`；应用退出经 `ShutdownCoordinator`；迟到 event 按 generation 丢弃。无 durable session 的 turn/slot 使用 ephemeral scope id（禁止 `__anon__` / `__no_session__`）。Conversation Stop 相位语义：`preparing` 干净撤销；`committing`/`running` 单调落停。Renderer 对 monotonic-stopped turn/request 丢弃迟到 `draft|streaming` patch。ProcessSupervisor 超时未观察到 close 时标记 `unconfirmed_orphan` 并保留 registry，禁止伪造已退出。
7. **失败有分类**：安全类 fail-closed；完整性 degrade-safe；可用性 recoverable。分类权威见 `docs/contracts/failure-model.md`。
8. **无 legacy 双轨**：新结构替代旧结构时直接收敛；默认不保留兼容 shim。
9. **对话模型**：Composer 底栏与 `/model` 选择的是**当前对话模型**，不写回 `.agent.md`。Settings 里的 Agent provider/model 只在用户还没点选时作为种子。有 session 时写入 `SessionRecord.modelOverride`；无 session 时只记 Composer 草稿，首次发送随 `configurationCommit` 进入 `resolveAgentRoutePreflight` 并在 session 落地后粘性保存。切 Agent **不清**模型。父 session 模型 **不传** sub agent。非法 model fail-closed，禁止静默回退 Agent 种子。

## Authority Map

| 主题 | 权威位置 |
| --- | --- |
| 产品边界与本文件不变量 | 本文件 |
| Runtime / Prompt / Provider / Tool / Session 契约 | [`docs/contracts/runtime-kernel.md`](docs/contracts/runtime-kernel.md) |
| Session Projection（active UI / 后台 cache / Composer 恢复） | [`docs/contracts/session-projection.md`](docs/contracts/session-projection.md) |
| Session `modelOverride`（所有权 / 冻结时机 / 不传子 agent） | 本文件 Architecture Principles §9；实现：`SessionRecord` + `resolveAgentRoutePreflight` |
| 权限、Bridge、Secret、MCP trust、Sandbox、CSP、IPC | [`docs/contracts/permissions.md`](docs/contracts/permissions.md) |
| Fail-closed 三分类与标注点 | [`docs/contracts/failure-model.md`](docs/contracts/failure-model.md) |
| Orchestrator façade 行数 / 职责外提 | 本文件 Invariant + `pnpm run check:orchestrator-facade` |
| Profiles / Skills / Hooks / Memory / RDX 产品规格 | [`docs/product/`](docs/product/) |
| Workbench / Transcript / Composer | [`docs/ui/workbench-and-transcript.md`](docs/ui/workbench-and-transcript.md) |
| Design System（Token / 按钮 / 颜色 / 组件） | [`docs/ui/design-system.md`](docs/ui/design-system.md) |
| Work Process UI 验收 checklist | [`docs/ui/work-process-checklist.md`](docs/ui/work-process-checklist.md) |
| Appearance UI 验收 checklist | [`docs/ui/appearance-checklist.md`](docs/ui/appearance-checklist.md) |
| 模块地图与数据流 | [`docs/architecture/`](docs/architecture/) |
| 工作流与 Debugger 主链 | [`docs/workflows/`](docs/workflows/) |
| Agent 修改纪律与验证命令 | [`AGENTS.md`](AGENTS.md) |

实现细节以源码为准；文档描述稳定契约，不回写运行时代码规则。

## 核心 Invariant

- **资源优先级**：`builtin < user < project`；整资源替换；policy 只收紧（deny 并集、审批强度只升、数值上限只降）。执行时 `built-in hard deny > user/project policy floor > Full access > tool metadata`；预算值必须是非负整数，`0` 表示禁止对应执行并 fail-closed，即使 Full access 也不能绕过 policy floor。Decision lattice 为 `allow < auto_review < ask_user < deny`；`approvalFloorByTool: user` 无条件 `ask_user`，不得被 Permission Mode（含 Auto-review）降级。
- **Skill 工具面**：`allowedTools = ∩(skill_i) ∩ runtimeAllowlist`（空声明不收窄）；skill 只能收窄、永不扩展 profile 工具集；元工具豁免见 runtime 契约。
- **Deferred tools**：未激活 deferred → `TOOL_NOT_ACTIVATED`；仅 `tool_search`（及契约允许的激活路径）可激活。
- **Tasks 能力真值**：Prompt 只描述 route 最终实际注入的工具。Ask 仅可读 `task_list` / `task_get`；Plan/Edit 仅在其冻结工具集确实包含 mutation 工具时才宣称可写。text-only route 不得列出、模仿或反复搜索 Tasks 工具。
- **Tool search 无匹配**：返回 `NO_MATCH_IN_EFFECTIVE_TOOL_SET`、`authoritative: true` 与有效工具集 fingerprint；fingerprint 未变化时禁止重复同一搜索。
- **Capability unknown**：`toolCalling.state === unknown` → text-only；仅 `supported` 才 `native-structured`。
- **输出通道**：`ProviderOutputRef` 一经声明永久归属 `thinking` | `text` | `tool_call` 之一；ref 必须承载 provider 侧 block 身份，已关闭的 block 不得复用，多 part / 多 item 必须映射到不同 ref；普通 assistant text 永不合成 thinking；仅 `final_answer` 写正文。
- **Secret**：`safeStorage` 不可用则 fail-closed；secret 不得进入 renderer / IPC 明文 / Trace / RequestPlan。
- **Browser Bridge (debug-only)**: only `RDC_AGENT_BROWSER_QA=1` (launcher browser/browser-dev) starts it. The authoritative entry is the one-time `/qa?qaBootstrap=...` URL printed by the launcher; successful bootstrap mints an HttpOnly `SameSite=Strict` cookie (with `Secure` for HTTPS) and redirects to clean `/app` on the **same bridge origin**. In `browser-dev`, Vite is reverse-proxied through the bridge (including HMR WebSocket); the browser never opens the Vite port and never carries bridge auth or a challenge in a URL query. Cookie-authenticated `/invoke`, `/events`, and `/api/*` require `Origin` equal to the bridge origin. Dev proxy strips `cookie` / `authorization` / `proxy-authorization` / `x-rdc-*` before forwarding to Vite. Programmatic clients may use an explicit Bearer header. Channel capability is a closed `Record<RendererInvokeChannel, BridgeChannelCapability>` in `src/shared/renderer-api/channelCapabilities.ts`; TypeScript forces every new channel to be classified; unknown channels fail closed. `high-impact` additionally requires `RDC_AGENT_BROWSER_QA_FULL_ACCESS=1`; `desktop-only` is always denied. Browser and Desktop share the single `src/shared/renderer-api` ElectronAPI factory and channel manifest. This surface is never part of the release default path. See docs/contracts/permissions.md and docs/architecture/browser-qa-surface.md.
- **MCP project**：同 ID 不可覆盖 user 的 command/args/url/env；变更需 `needsRetrust` + 显式 trust；运行时连接按 `projectRoot + descriptorHash` 建立独立 ref-counted pool，handoff 只属于当前 Turn terminal result。
- **RDX**：无内置 CLI 副本；Open `.rdc` 等垂直入口只走 Settings 配置的 shell action。
- **外部解释器**：`code_interpreter` 只执行 Settings `tooling.codeInterpreter` 配置的本机解释器（默认探测系统 Python）；不内置运行时，不挂 `rdxCli`，未启用 fail-closed。产物经 `RDC_INTERPRETER_ARTIFACTS_DIR` 扫描登记。
- **`read_image`**：`visionInputMode !== 'native'` 时 `VISION_INPUT_UNSUPPORTED` fail-closed，与附件 vision 输入一致。
- **图像预览单通道**：工具图只经 session `image-previews` + `conversation:getToolImagePreview`（Zod + active-session gate）给 renderer；大 base64 不得进入 `resultPreview`。模型侧把 tool-result 图桥成紧随的 user image part，禁止静默丢图。用户附件缩略图走 `conversation:getAttachmentPreview`：staging 预览无 session；已提交附件必须带 `sessionId` 且过 active-session gate。
- **用户附件管道**：Composer `+` 只附加图片/文件（path 或 bytes 经 `conversation:stageAttachments`）。`.rdc`、可执行文件与 **SVG** 硬拒（SVG 不进 vision / inline）。Staging 写 `{userData}/state/staging/attachments/`，进程启动清空，preparing 失败不落 session。prepare 冻结最终 session 逻辑路径与 inline 文本；run 只补 image 字节。物化分层：image → native vision；text/pdf → tokenizer 预算 inline；binary → 元数据路径。当前 session `attachments/` 仅对 `read_file`/`read_image`/`glob`/`grep` 自动只读授权。禁止 `session:attachments:list` / `import` IPC。
- **Tasks 快照卡**：transcript 只展示相邻合并的快照卡（`N of M completed` + 划线）；不相邻各自留卡。Right Rail Progress 仍是唯一实时任务真源；点击定位靠 `data-work-process-task-id`。
- **Capture 所有权**：`ownerSessionId` 不匹配则 fail-closed；不得跨 session 继承已打开 capture。
- **唯一 Turn Preparation**：`sendMessage` / `sendProfileMessage` / Subagent 经 `ProfileTurnPreparation`（或 conversation `prepareTurn`）冻结 `preparedRuntime`；`AgentTurnRunner` 无 preparedRuntime 抛 `TURN_NOT_PREPARED`，禁止 fallback plan。
- **AgentState 复合键**：`sessionId|ephemeralScope` + `agentId`；renderer `agentStore` 与 IPC bridge 无 sessionId 的事件丢弃。
- **存储 fail-closed**：`StorageIo.readJson` / `readYaml` 区分 ENOENT(null)、损坏（quarantine + `STORAGE_CORRUPT`）与未知更高 `schemaVersion`/`schema_version`（`STORAGE_SCHEMA_UNSUPPORTED`，不 quarantine）。JSON store 经 zod runtime 校验；带版本的文档走 `schemaVersion → migration registry → 升级`。`session_evidence.yaml` 走 `SESSION_EVIDENCE_MIGRATIONS`；`attachments.json` 现写 `{ schemaVersion, attachments }`，已有纯数组仍按当前 Zod 形状校验；`session.json` / `attachments.json` / `run.json` / `run.yaml` 若带更高版本同样 fail-closed，缺版本仍按当前 Zod 形状校验。Settings 的 `rebuildPersistedSettings` 是该框架下的 settings 迁移实现，未知更高版本同样 fail-closed。写入走 atomic rename；`deepMerge` 拒绝 `__proto__`/`constructor`。Memory `.memory.lock` 与 Project `registry.json` 的 `.registry.lock` 共用 `directoryFileLock`：**活 pid 永不回收**，仅死 pid 或损坏锁文件可回收；Project registry 的 create/rename/remove/touch 读改写在同一把锁内。
- **MCP transport**：仅 `stdio` / `streamable-http`；`sse` 配置 fail-closed（`MCP_TRANSPORT_UNSUPPORTED`）。Pool identity：`realpath + projectId + descriptorHash`；失败缓存指数退避；orphan pool quarantine。
- **ToolValidator**：严格 JSON Schema 子集；只接受 `SUPPORTED_SCHEMA_KEYS` 白名单；未声明字段与未实现关键字编译期 `UNSUPPORTED_TOOL_SCHEMA` fail-closed。
- **Orchestrator façade**：`AgentOrchestrator.ts` 保持 façade（**少于 800 行**）；turn 准备、tool 装配、executor、turn/subagent runner、prompt-plan、memory UI 等职责外提到协作单元；门禁 `pnpm run check:orchestrator-facade`（亦挂在 `check:architecture`）。
- **CSP**：生产 `script-src` 无 `unsafe-inline`；`style-src 'self'`（无 `unsafe-inline`）；`style-src-attr 'none'`；动态样式经 constructable stylesheet（`useDynStyle` / `assignDynStyle` / Appearance `applyChromeTheme`），禁止依赖 inline style attributes 或 `<style>` textContent 注入。Appearance chrome 权威见 [`docs/ui/design-system.md`](docs/ui/design-system.md)；`chromeThemes` 由 Settings `schemaVersion` **6** 起在升级时硬重置为 RDC 默认（不可逆，清历史污染）。
- **IPC Zod**：全部 IPC handler 经 `parseIpcArgs`；非法 payload fail-closed；`approvalToken` 单次消费。
- **RDX context lease**：仅 per-session lease（`setRdxRuntimeContextForSession` / `getRdxContextLease` / `assertRdxContextLeaseOwnership`）；**禁止** RDX global mirror、`legacyGlobalMirror`、`getRdxRuntimeContext` 全局 API。
- **Session Projection**：主进程允许多 session 并行 turn；renderer 仅投影 `currentSession`；带 `sessionId` 的 IPC 流式/投影事件必须经 active-session gate，后台写入 `sessionProjectionStore`；Composer draft 恢复与 Stop/Rewrite monotonic 绑定 owning session/`requestId`。权威见 [`docs/contracts/session-projection.md`](docs/contracts/session-projection.md)；门禁 `pnpm run check:session-projection`。
- **EffectiveRuntimePlan**：`schemaVersion: 3`；在 `prepareTurn` **完整冻结**（`planId` / fingerprint / tools / skill ∩ / deferred / MCP hash / permission / policy / `contextCompactionPercent` / route / request+prompt fingerprints / 附件 manifest 指纹）；Prompt 与 Executor 共用；在途 turn 不读可变 Settings。
- **上下文预算**：`contextTierPromptCap` = `maxPromptTokens ?? maxTotalTokens`，不扣模型输出上限。压缩触发为 `min(用户 compactionThresholdPercent, policy.contextCompactionPercent)`（policy ≥100 不约束；结果 clamp 50–90 / 步长 5）。规划上限走 `resolvePlanningOutputTokens`（声明值 / 拆窗差值 / 窗口本身）。每次 LLM call 的 `max_tokens` = `min(规划上限, window − promptTokens − safety)`；缺省输出上限 = 剩余窗口，禁止把缺省写成 0。装不下先压缩再 `CONTEXT_CANNOT_FIT` fail-closed。

## Document Index

### Contracts

- [`docs/contracts/runtime-kernel.md`](docs/contracts/runtime-kernel.md) — Agent loop、Prompt/Request、Reasoning、Tools、Session、Model capability
- [`docs/contracts/session-projection.md`](docs/contracts/session-projection.md) — Active Session Projection、IPC gate、Composer 恢复、Stop/Rewrite monotonic
- [`docs/contracts/permissions.md`](docs/contracts/permissions.md) — Permission mode、Sandbox、CSP、IPC Zod 全量、Bridge、Secret、RDX lease、MCP trust、Shell
- [`docs/contracts/failure-model.md`](docs/contracts/failure-model.md) — Security / Integrity / Availability

### Product

- [`docs/product/scoped-runtime-resources.md`](docs/product/scoped-runtime-resources.md) — Scope、Profiles、Skills、Hooks、Memory、Project Instructions
- [`docs/product/vertical-debugger-overview.md`](docs/product/vertical-debugger-overview.md)
- 其它：`docs/product/README.md`

### UI

- [`docs/ui/workbench-and-transcript.md`](docs/ui/workbench-and-transcript.md) — Workbench 轨、Work Process、Composer、Markdown
- [`docs/ui/design-system.md`](docs/ui/design-system.md) — Token、按钮、颜色、组件规则、Appearance 双体系
- [`docs/ui/work-process-checklist.md`](docs/ui/work-process-checklist.md) — Work Process UI 验收清单
- [`docs/ui/appearance-checklist.md`](docs/ui/appearance-checklist.md) — Appearance / Provider/Composer 控件 / Effort 滑杆验收清单
- [`docs/ui/knowledge-center.md`](docs/ui/knowledge-center.md)

### Architecture / Workflows

- [`docs/architecture/README.md`](docs/architecture/README.md)
- [`docs/architecture/browser-qa-surface.md`](docs/architecture/browser-qa-surface.md) — Browser QA 与桌面 channel 矩阵（debug-only）
- [`docs/workflows/README.md`](docs/workflows/README.md)

## Verification Gate（摘要）

**宣称完成必须以门禁与浏览器证据为准**，不得仅靠 commit message。

本地 / CI（`.github/workflows/ci.yml`）必跑：`check:repository-hygiene` → `typecheck` → `lint` → `test` → `test:coverage` → `check:coverage-ratchet`（只升不降；基线 `scripts/fidelity/coverage-ratchet.json`）→ `check:architecture`（含 Orchestrator &lt;800 与 main 单文件 ≤900）→ 全套关键 `check:*`（含 `check:browser-capability` / `check:release-config`）→ `check:contracts` → `build`。并行：`browser-smoke`（xvfb + smoke:agent-browser 双 FULL_ACCESS 矩阵）、`desktop-smoke`、三 OS `launcher-fresh-checkout`/`pack`（Linux 上 SBOM/checksum）。

UI/工作流用 `pnpm run start:agent-browser` 真实会话验收（先停旧进程、删光 QA project 全部 session、再新建隔离 session）。完整清单见 `AGENTS.md`。

Settings `schemaVersion` **6**：升级时不可逆重置 `appearance.chromeThemes` 为 RDC 默认（清理历史污染）。桌面窗口几何写入 `layout.window`（宽高/坐标/最大化），主进程在 resize/move/close 时持久化并在启动恢复；左右栏与 terminal 高度仍经 renderer `settings:set` 持久化。Browser 与 Desktop 走同一 Settings 持久化路径；Browser QA 默认使用经过校验并在退出清理的 disposable `os.tmpdir()/rdc-agent/qa-*` userData，只有显式 `RDC_AGENT_USER_DATA` 或 `RDC_AGENT_USE_CANONICAL_USERDATA=1` 才共享 canonical userData，`instance.lock` 阻止并发占用。

## Right Rail Authority

Right Rail has two target-specific surfaces. Selecting a Project renders only the project-scoped `Import .rdc` input surface and its imported capture list; it never reads session runtime state. Selecting a Session renders the fixed `Progress / Outputs / Context / Capture` inspector. The main-owned `RightRailProjectionService` still assembles `RightPanelViewModel` for an explicit `{ projectId, sessionId }`; renderer consumes that projection and does not rebuild session business state. Context is limited to concrete task resources proven by frozen Prompt segments or successful tool results; generic tool categories and configured-but-unused Skill/MCP entries are not resources. Capture is always visible in a session: it is either an honest `.rdc` empty state or the owner-session selection/open/preview surface. Runtime identifiers remain owner-scoped agent data. Outputs expose only user-facing output-file categories: an agent must explicitly publish a finished project file through `output_register`, which copies it into the owning run before projection; inputs and plans are rejected. Progress, Outputs, Context, and Capture always remain four separate, non-collapsible rounded cards with the same background, border, title treatment, padding, and spacing whether empty or populated. Empty content uses the quiet original wireframe illustration; populated content grows only its own card and uses internal hairlines between sibling rows. The dock remains available through compact desktop widths and becomes the shared overlay drawer only at or below `RIGHT_RAIL_DRAWER_BREAKPOINT` (920px), or when geometry cannot preserve the minimum work surface. Static enforcement: `pnpm run check:right-rail`.
