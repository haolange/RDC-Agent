# RDC-Agent Design and Architecture Guide

`DESIGN.md` 是本仓库**产品边界、架构原则、权威地图与核心不变量**的裁决文件。若 `README.md`、`AGENTS.md` 或 `docs/**` 与本文件冲突，以本文件为准并同步修正其它文档。详细契约、产品规格与 UI 规范已分拆到 `docs/`，本文件只保留裁决层与索引，避免根目录堆叠运行时细则。

## Product Boundary

RDC-Agent 是通用 agent workbench，并一等公民支持 RDC/RDX 与 RenderDoc `.rdc`。它应能作为日常 agent 工作台完成阅读、规划、编辑、搜索、工具调用、handoff、memory 与 subagent 编排，同时保留 capture 打开、replay 上下文、RDX actions、诊断与 RenderDoc 调查等垂直能力。

**发布面是 Windows-only。** `electron-builder.json` 只保留 `win`；mac/linux 安装包与公证不在产品范围内。POSIX launcher wrapper（`.sh`）仅供 Ubuntu CI 的 node 面准备，不是发布目标。Windows release 通道（`RDC_AGENT_RELEASE_CHANNEL=release` 或 git tag）必须提供 `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`（或 `CSC_*` 别名）；本地 `pnpm run pack` 保持不签名。SBOM 由完整 `pnpm-lock.yaml` 传递依赖图生成 CycloneDX，并记录 git SHA 与 lockfile digest。

**不做** image/video 生成 runtime、media provider 目录面或 `MediaRuntimeService` 类骨架；discovery 对非 agent modality（含 image/video output）保持 fail-closed 剔除。用户附件 vision-input（读图）仍属 agent chat 能力，与生成 media 无关。

产品不是固定模式向导。**Wave 1 已落地**四个 builtin profile：`general` / `debugger` / `analyzer` / `optimizer`（`resources/agent-runtime/agents`，scope 优先级 `builtin < user < project`，不再写 user seed）。仅 `user-invocable` 的 profile 出现在 composer orchestrator 菜单。`/plan` 不再硬切 builtin plan。durable handoff runtime、Knowledge、五卡 Right Rail 与 Investigation schema **尚未实现**。裁决与迁移门禁见下文「Current / Target / Migration Adjudications」。

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
9. **对话模型**：Composer 底栏与 `/model` 选择的是**当前对话模型**，不写回 `.agent.md`。Settings 里的 Agent provider/model 只在用户还没点选时作为种子。未 override 是显式可选状态（菜单「按 Agent 配置」与 `/model default`）：有 session 时清除写入 `SessionRecord.modelOverride = null`，无 session 时清 Composer 草稿。Agent route 当前不可执行时禁止清除，避免把会话推进发送必失败的种子。`/model` 与底栏共用 EffectiveCatalog + `isAgentToolExecutableModel` 可选集；裸 `default` 先于 `provider:model` 解析，真名叫 `default` 的模型用 canonical `provider:model` 逃生。有 session 时写入 `SessionRecord.modelOverride`；无 session 时只记 Composer 草稿，首次发送随 `configurationCommit` 进入 `resolveAgentRoutePreflight` 并在 session 落地后粘性保存。切 Agent **不清**模型。父 session 模型 **不传** sub agent。Agent 可执行模型必须具备 source-backed `toolCalling.supported` 与已实现 structured-tool adapter；`unknown`/`unsupported` 不是选择项，已持久 override 或 Agent route 指向它们时 fail-closed 并给出同 provider 已验证候选项，禁止静默回退。Settings catalog 仍保留完整可审计记录。非法 model fail-closed，禁止静默回退 Agent 种子。
10. **Agent Shell**：命令工具 id 是 `shell`。解释器由 `ShellResolver` 解析（Settings `tooling.shell.executable` 本机覆盖 → 真实 pwsh 7 → Windows PowerShell 5.1；POSIX 优先 `$SHELL`（basename ∈ zsh/bash/sh/dash）→ `/bin/zsh` → `/bin/bash` → `/bin/sh`）。fish/csh/nu 等 fail-closed。全部失败抛 `SHELL_UNAVAILABLE`，不静默降级到 `cmd.exe`。POSIX 非交互走 login `-lc`；Windows 5.1 不改 `[Console]::OutputEncoding`，改用独立 UTF-8 writer，并显式 `$PSNativeCommandUseErrorActionPreference = $false`。每次调用 spawn 新进程，只用 GUID begin/trailer 回读 cwd；只持久化文件系统且位于 project root 内的 cwd 到 session `shell-state.json`，不存 env。旧 token `bash` 进入 `REJECTED_TOOL_TOKENS`，无展示别名、无静默映射。

## Authority Map

| 主题 | 权威位置 |
| --- | --- |
| 产品边界与本文件不变量 | 本文件 |
| 当前态 / 目标态 / 迁移门禁（Profile、Right Rail、Embedding、Handoff、Investigation、并发、Knowledge、legacy） | 本文件「Current / Target / Migration Adjudications」 |
| Runtime / Prompt / Provider / Tool / Session 契约 | [`docs/contracts/runtime-kernel.md`](docs/contracts/runtime-kernel.md) |
| Session Projection（active UI / 后台 cache / Composer 恢复） | [`docs/contracts/session-projection.md`](docs/contracts/session-projection.md) |
| Session `modelOverride`（所有权 / 冻结时机 / 不传子 agent） | 本文件 Architecture Principles §9；实现：`SessionRecord` + `resolveAgentRoutePreflight` |
| 权限、Bridge、Secret、MCP trust、Sandbox、CSP、IPC | [`docs/contracts/permissions.md`](docs/contracts/permissions.md) |
| Fail-closed 三分类与标注点 | [`docs/contracts/failure-model.md`](docs/contracts/failure-model.md) |
| Orchestrator façade 行数 / 职责外提 | 本文件 Invariant + `pnpm run check:orchestrator-facade` |
| Profiles / Skills / Hooks / Memory / RDX 产品规格 | [`docs/product/`](docs/product/) |
| RenderDoc 垂直目标设计（非第二权威） | [`docs/product/renderdoc-agent-complete-design.md`](docs/product/renderdoc-agent-complete-design.md) |
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
- **Tasks 能力真值**：Prompt 只描述 route 最终实际注入的工具。Ask 仅可读 `task_list` / `task_get`；Plan/Edit 仅在其冻结工具集确实包含 mutation 工具时才宣称可写。text-only route 不得列出、模仿或反复搜索 Tasks 工具。可写时 `task_create` 一次批量建全表；开工前仅一条 `in_progress`；完成后立即 `completed` 再开下一条；`blocked` 必须带 `statusReason`；单步或琐碎工作不建任务。
- **Tool search 无匹配**：返回 `NO_MATCH_IN_EFFECTIVE_TOOL_SET`、`authoritative: true` 与有效工具集 fingerprint；fingerprint 未变化时禁止重复同一搜索。
- **Capability unknown**：`toolCalling.state === unknown` → text-only，且不得进入 Agent/Composer 可执行集合；仅 `supported` 且具备已实现 structured-tool adapter 才 `native-structured`。`unsupported` 保持明确拒绝诊断，不得复用到 unknown。
- **输出通道**：`ProviderOutputRef` 一经声明永久归属 `thinking` | `text` | `tool_call` 之一；ref 必须承载 provider 侧 block 身份，已关闭的 block 不得复用，多 part / 多 item 必须映射到不同 ref；普通 assistant text 永不合成 thinking；仅 `final_answer` 写正文。
- **Secret**：`safeStorage` 不可用则 fail-closed；secret 不得进入 renderer / IPC 明文 / Trace / RequestPlan。
- **Browser Bridge (debug-only)**: only `RDC_AGENT_BROWSER_QA=1` (launcher browser/browser-dev) starts it. The authoritative entry is the one-time `/qa?qaBootstrap=...` URL printed by the launcher; successful bootstrap mints an HttpOnly `SameSite=Strict` cookie (with `Secure` for HTTPS) and redirects to clean `/app` on the **same bridge origin**. In `browser-dev`, Vite is reverse-proxied through the bridge (including HMR WebSocket); the browser never opens the Vite port and never carries bridge auth or a challenge in a URL query. Cookie-authenticated `/invoke`, `/events`, and `/api/*` require `Origin` equal to the bridge origin. Dev proxy strips `cookie` / `authorization` / `proxy-authorization` / `x-rdc-*` before forwarding to Vite. Programmatic clients may use an explicit Bearer header. Channel capability is a closed `Record<RendererInvokeChannel, BridgeChannelCapability>` in `src/shared/renderer-api/channelCapabilities.ts`; TypeScript forces every new channel to be classified; unknown channels fail closed. `high-impact` additionally requires `RDC_AGENT_BROWSER_QA_FULL_ACCESS=1`; `desktop-only` is always denied. Browser and Desktop share the single `src/shared/renderer-api` ElectronAPI factory and channel manifest. This surface is never part of the release default path. See docs/contracts/permissions.md and docs/architecture/browser-qa-surface.md.
- **MCP project**：同 ID 不可覆盖 user 的 command/args/url/env；变更需 `needsRetrust` + 显式 trust；运行时连接按 `projectRoot + descriptorHash` 建立独立 ref-counted pool，handoff 只属于当前 Turn terminal result。
- **RDX**：无内置 CLI 副本；Open `.rdc` 等垂直入口只走 Settings 配置的 shell action。
- **外部解释器**：`code_interpreter` 只执行 Settings `tooling.codeInterpreter` 配置的本机解释器（默认探测系统 Python）；不内置运行时，不挂 `rdxCli`，未启用 fail-closed。产物经 `RDC_INTERPRETER_ARTIFACTS_DIR` 扫描登记。
- **`read_image`**：`visionInputMode !== 'native'` 时 `VISION_INPUT_UNSUPPORTED` fail-closed，与附件 vision 输入一致。
- **图像预览单通道**：工具图只经 session `image-previews` + `conversation:getToolImagePreview`（Zod + active-session gate）给 renderer；大 base64 不得进入 `resultPreview`。模型侧把 tool-result 图桥成紧随的 user image part，禁止静默丢图。用户附件缩略图走 `conversation:getAttachmentPreview`：staging 预览无 session；已提交附件必须带 `sessionId` 且过 active-session gate。
- **用户附件管道**：Composer `+` 只附加图片/文件（path 或 bytes 经 `conversation:stageAttachments`）。`.rdc`、可执行文件与 **SVG** 硬拒（SVG 不进 vision / inline）。Staging 写 `{userData}/state/staging/attachments/`，进程启动清空，preparing 失败不落 session。prepare 冻结最终 session 逻辑路径与 inline 文本；run 只补 image 字节。物化分层：image → native vision；text/pdf → tokenizer 预算 inline；binary → 元数据路径。当前 session `attachments/` 仅对 `read_file`/`read_image`/`glob`/`grep` 自动只读授权。禁止 `session:attachments:list` / `import` IPC。
- **session:// Artifact**：URI `session://<plans|investigation|tool-outputs>/<relative-path>` 只解析到 owning session 的 `<sessionPath>/session-artifacts/<category>/`。配额：单文件 2 MiB，artifact_read 返回窗 200 KiB / 2000 行，自动卸货阈值 32 KiB（序列化后），session 合计 96 MiB，tool-outputs 最多 256 文件；MIME 白名单 text/plain、text/markdown、application/json、text/csv、text/yaml、image/png|jpeg|gif|webp；硬拒 SVG / 可执行 / `.rdc`。investigation/plans 本 Wave 只预留 category。不进入 attachments 自动授权，`read_file` 不放宽。
- **Tasks 快照卡**：一轮只保留一张活的任务卡。canonical order 与派生状态由 main 侧 `taskProjection` 单点投影，transcript 与 Right Rail Progress 同序、同态、同副标题；点击定位靠 `data-work-process-task-id`。
- **Capture 所有权**：`ownerSessionId` 不匹配则 fail-closed；不得跨 session 继承已打开 capture。
- **唯一 Turn Preparation**：`sendMessage` / `sendProfileMessage` / Subagent 经 `ProfileTurnPreparation`（或 conversation `prepareTurn`）冻结 `preparedRuntime`；`AgentTurnRunner` 无 preparedRuntime 抛 `TURN_NOT_PREPARED`，禁止 fallback plan。
- **AgentState 复合键**：`sessionId|ephemeralScope` + `agentId`；renderer `agentStore` 与 IPC bridge 无 sessionId 的事件丢弃。
- **存储 fail-closed**：`StorageIo.readJson` / `readYaml` 区分 ENOENT(null)、损坏（quarantine + `STORAGE_CORRUPT`）与未知更高 `schemaVersion`/`schema_version`（`STORAGE_SCHEMA_UNSUPPORTED`，不 quarantine）。JSON store 经 zod runtime 校验；带版本的文档走 `schemaVersion → migration registry → 升级`。`session_evidence.yaml` 走 `SESSION_EVIDENCE_MIGRATIONS`；`attachments.json` 现写 `{ schemaVersion, attachments }`，已有纯数组仍按当前 Zod 形状校验；`usage.json` 现写 `{ schemaVersion: '2', usage }`；`context-view.json` 现写 `{ schemaVersion: '1', view }`，缺版本的裸 `DerivedContextView` 经 `SESSION_CONTEXT_VIEW_MIGRATIONS` 包一层；`session.json` / `attachments.json` / `run.json` / `run.yaml` 若带更高版本同样 fail-closed，缺版本仍按当前 Zod 形状校验。Settings 的 `rebuildPersistedSettings` 是该框架下的 settings 迁移实现，未知更高版本同样 fail-closed。写入走 atomic rename；`deepMerge` 拒绝 `__proto__`/`constructor`。Memory `.memory.lock` 与 Project `registry.json` 的 `.registry.lock` 共用 `directoryFileLock`：**活 pid 永不回收**，仅死 pid 或损坏锁文件可回收；Project registry 的 create/rename/remove/touch 读改写在同一把锁内。
- **Reasoning 续接**：`session-context.jsonl` 是 canonical 中性历史；`ContinuationReplayPolicy` 只按 compiled execution identity 决定同绑定回放 / 跨绑定 drop。切模型只改下一轮 route，不自动 compact，也不引入迁移事务、portable work state、workspace checkpoint。provider/model/protocol 变化且存在将被丢弃的 continuation 制品时，普通 Send 与 rewrite 都插入同一条 continuation-drop 系统通知。DeepSeek 带 tools 的 thinking-mode 协议要求跨轮回传 reasoning，对应 route 的 `artifactScope` 为 `all-assistant-turns`；`requirement: required` 的制品不受 8 轮 retention 过期，只随 compaction 边界终止。
- **结构化压缩**：manual `/compact` 与预算触发 auto-compact 共用 `PromptPlan → RequestEnvelope → adapter` 单轮、无工具的 model-generated `StructuredHandoff`（`derivation: 'model-generated'`）。LLM 失败显式报错（Availability recoverable），不静默回退确定性抽取。低于阈值或可见回合过短时返回 `status: 'noop'`，不写 `complete` 压缩工作块。
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
- [`docs/product/renderdoc-agent-complete-design.md`](docs/product/renderdoc-agent-complete-design.md) — 受本文件裁决的详细目标设计；目标态未全部实现
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

## Current / Target / Migration Adjudications

本节是 Wave 0 原子裁决。凡写「当前态」即仓库现有实现；「目标态」即后续 Wave 必须收敛到的单一路径；「迁移门禁」是实现该目标时的数据/契约约束。目标态未实现前，不得把目标模块写成已完成，也不得为旧路径增加兼容双轨。详细字段与领域流程见 [`docs/product/renderdoc-agent-complete-design.md`](docs/product/renderdoc-agent-complete-design.md)；该文件受本裁决约束，不是第二产品权威。

非侵入硬约束（当前态与目标态共同成立）：

- 不新增平台级 InvestigationGraph、第二 TaskStore 或第二 Agent Runtime。
- `TaskRecord.metadata`、`AgentProfile.metadata`、`ConversationMessage` 禁止领域字段；垂直记录只能引用 task id。
- 不注册约 194 个 RDX 工具，不把 RDX 做成 MCP；RDX 仍是外部 CLI，经 `shell` 与 Settings action 调用。
- Knowledge 持久写入仅 human review；`FullAccess` 不可绕过；无自动 Memory / Knowledge / Candidate / Promote。
- 新结构替代旧结构时直接收敛；默认不保留 legacy / deprecated shim。

### A. Builtin Profiles

| | 裁决 |
| --- | --- |
| **当前态（Wave 1 已落地）** | 四个 builtin profile：`general`（Execution Orchestrator）、`debugger` / `analyzer` / `optimizer`（Planning Orchestrator）。官方文件只存在于 `resources/agent-runtime/agents`。生效优先级 **`builtin < user < project`**，整资源替换，builtin 属性由 scope 派生。运行时**不再写 user seed**。Settings / Composer / Conversation preflight 共用 project-aware effective snapshot。`handoffs` 可省略或显式空（合法=禁止 handoff）；任一畸形 entry 使整个 candidate invalid。空 `agents` 仅允许 self delegate。`AgentId` / `TOP_LEVEL_AGENT_IDS` 只含四 builtin；用户保留的 ask/plan/edit 仍可按 custom manifest 运行。Run v2 用 `kind: conversation\|mission` + `profileId`，新写无 `mode`。 |
| **目标态** | 与 Wave 1 拓扑相同。durable handoff 状态机、Knowledge 工具、五卡 Right Rail、Investigation schema 仍属后续 Wave，不得写成已完成。不新增 `mission` / `orchestratorType` / `investigationMode` 等 Profile 领域字段。 |
| **迁移门禁** | 历史官方 seed 世代诚实编号为 S0–S9（从 git 历史抽出，不编造）。以 **parse 后的语义 hash** 识别（instructions / tools / skills / agents / handoffs / **model / icon / accent** 任一变化都视为用户修改；历史动态 model 无法证实时不匹配）。匹配历史官方语义的旧文件原子移至 `~/.rdx/agents/.migrated/<migration-id>/` 备份，**不物理删除**。用户修改版原样保留。marker `~/.rdx/agents/.seed-migration.json` `schemaVersion:'1'`，经 `StorageIo` 原子写，未知高版本 fail-closed，幂等 / 可重入并写诊断。`.migrated` 不枚举。Ask / Plan / Edit 不再作为目标拓扑身份，也不作为运行时 fallback。 |

### B. Right Rail

| | 裁决 |
| --- | --- |
| **当前态** | Project rail 只有 `Import .rdc` 与已导入列表。Session rail 是四张不可折叠卡：`Progress / Outputs / Context / Capture`。`RightRailProjectionService` 单轨投影；renderer 不重建。Outputs 只认 `output_register`。 |
| **目标态** | Project rail **仍只有** `Import .rdc`，不读 session runtime。Session rail 目标五卡：`Progress / Artifacts / Outputs / Context / Capture`。Artifacts 是 main-owned Investigation Artifacts（垂直 Session Artifact 投影，不是 Working Directory 扫描，也不是 `output_register`）。Outputs 仍只展示 `output_register` 发布的用户输出文件。Capture 保留现有所有权与 Replay Device 面。Progress 仍消费 canonical `taskProjection`。五卡外壳在 empty / populated 之间不变。单轨投影与「renderer 不重建」不变。 |
| **迁移门禁** | 不得再写目标三卡（`Progress / Artifacts / Context`）或把当前四卡写成最终契约。实现五卡前，四卡是 Wave 迁移事实；落地后直接收敛到五卡，删除四卡分支。门禁仍走 `pnpm run check:right-rail`，后续须覆盖 Artifacts 卡与跨卡所有权。 |

### C. Independent Embedding Capability

| | 裁决 |
| --- | --- |
| **当前态** | Discovery 对 embedding / embeddings 等非 agent modality fail-closed 剔除。不存在独立 Embedding catalog / execution / consent。Knowledge 尚无 semantic lane 实现。 |
| **目标态** | Embedding 是**独立 capability**，不进入 Agent / Composer / subagent picker，也不并入 EffectiveCatalog 的 agent 可选集。路径：manifest `embeddings` → `EmbeddingCatalog` → `EmbeddingExecutionService`。使用独立 `embeddings` protocol / adapter。opaque credential 的 `operation=embed`。用户 consent **默认关**。semantic lane 在未配置、拒绝或构建失败时返回 `unavailable` / `stale` 并 fail-closed，其余 Knowledge lane 仍可工作，但不得宣称已做语义检索。索引绑定 identity / dimension / chunker / corpus hash；重建必须显式 rebuild。Discovery 的 agent modality 边界**不放松**。 |
| **迁移门禁** | 禁止把 embedding 模型写进 Agent route、`isAgentToolExecutableModel` 或 Settings Agents 可选集。禁止静默上传 User / Project Knowledge。实现前不得把 `EmbeddingCatalog` 写成已存在模块。 |

### D. Profile Handoff Durable State Machine

| | 裁决 |
| --- | --- |
| **当前态** | `AgentHandoffDefinition` 仍只是 manifest 路由声明。Durable 状态机已落地：`ProfileHandoffState`（`src/shared/types/profileHandoff.ts`）经 `HandoffStateStore` 写入 `<sessionPath>/handoff-state.json`。 |
| **目标态** | 每个 handoff 实例是 session-owned durable 记录，状态为 `prepared` → `committed` → `consumed`，或任意未完成点进入 `cancelled`。必填字段：`handoffId` / `lifecycle` / `sourceTurnId` / `sourceRequestId` / `sourceAgentId` / `toAgentId` / `chainRoot` / `depth` / `prompt` / `label` / `declaredModel` / timestamps / `cancelReason`。`declaredModel` **字段必存在，值可为 `null`**。`prepared` 仅工具成功；`committed` 仅源 turn complete；`consumed` 仅目标消息 commit。`send:true` 在 committed 后自动续跑。每个用户 root 链最多 3 次 handoff。进程重启后未 consumed 的实例降级为手动继续，不自动续跑。Stop / Rewrite / branch / 手动切换 profile 取消未完成 handoff。审批不继承。同一 session 同时只允许一个活跃 handoff。非法 model fail-closed。模型优先级始终：**session `modelOverride` > 通过 `isAgentToolExecutableModel` 校验的 handoff `declaredModel` > target route**。空 `handoffs` 禁止；空 `agents` 仅自身。字段细则见详细目标设计。 |
| **迁移门禁** | 实现必须新增 durable store（经 `StorageIo`），不得宣称「现有 `AgentHandoffDefinition` 已足够」。不得为旧无状态 handoff 增加永久双写。 |

### E. Investigation Vertical Schema

| | 裁决 |
| --- | --- |
| **当前态** | Session Artifact / Trace Artifact 是通用路径引用。不存在平台级 Investigation Graph，也没有字段级 `WorldState` / `EvidenceRecord` / `ClaimRecord` 等强 schema。 |
| **目标态** | 混合 schema namespace `rdc.investigation.v1`，**只**存在于垂直 Session Artifact：`WorldState`、`EvidenceRecord`、`ClaimRecord`（Hypothesis 是 `claimKind`，Decision 内嵌）、`ExperimentRecord`、`ChallengeRecord`、`MissionCheckpoint`、`InvestigationArtifactManifest`。记录必有稳定 id（`claimId` / `experimentId` / `challengeId` / `artifactId`）；causal / counterfactual Claim 必须带可解引用 `experimentId`。系统不变量 `S-CTX-01` / `S-STATE-01` / `S-CLAIM-01` / `S-CAUSAL-01` / `S-KNOW-01` / `S-KNOW-02` / `S-RDC-01` 在该 schema 上做机器判定。认识论偏序 `unknown < inferred < derived < observed`；Confidence 与 Verification 分离。`ready` 必须结构化 `sourceRefs`（`{ artifactId, expectedHash }`）`>= 1`、各 `expectedHash` 与源当前 sha256 匹配、`contentHash` 等于 `contentRef` 正文字节 sha256、`kind` 经闭集 Registry 解析到 `recordType + schema` 且正文通过；旧版本标 `superseded`。compact / report / view 投影 Claim 必须带 `compactProvenance`，否则违反 `S-CLAIM-01`。`S-RDC-01`：mutate 必有 Experiment + exclusive world state + rollback / restored 验证，否则 `polluted` / `stale`。`S-CAUSAL-01`：causal / counterfactual Claim 必须引用**可解引用**的 `ExperimentRecord`，且该实验 `intervention.type != none`、`status ∈ {recorded, rolled_back}`、`rollback.executed === true`、`rollback.baselineRestored === true`、并存在 verify evidence（三者均须满足）。字段细则见详细目标设计。 |
| **迁移门禁** | 禁止把上述字段写入 `TaskRecord` / `AgentProfile` / `ConversationMessage`。垂直记录只能引用 task id。禁止新建平台级 Graph Service。`pnpm run check:investigation-system` ratchet 已建立、目标债务未清零。 |

### F. Concurrent Tools

| | 裁决 |
| --- | --- |
| **当前态** | `AgentTool.spec.isConcurrencySafe` 缺省 `false`。`ConcurrentToolScheduler` 只并发同轮连续安全组；unsafe 独占。`shell` / write / task mutation / RDX / MCP / ask / handoff / `output_register` 与 `requiresRdxLease=true` 的 subagent 串行。offline subagent（`requiresRdxLease=false`）可进并发组。dispatch 前 `reserveDispatchBudget` 原子扣减；失败整组不开。结果按 `callIndex` 回填；部分失败不连坐已发出调用；abort `allSettled` join。 |
| **目标态** | 并发缺省不安全：只有 `AgentTool.spec.isConcurrencySafe === true` 才安全，缺省 `false`。只并发**连续**安全组；unsafe 独占。`shell` / write / task mutation / RDX / MCP / ask / handoff / `output_register` 串行。`callIndex` 保持稳定顺序。dispatch 前原子扣减预算。abort 必须 `allSettled` join。部分失败不连坐同组其余已发出调用的结果记录，但不得继续开新组。offline subagent 必须 `requiresRdxLease=false`。 |
| **迁移门禁** | 实现前不得把并发执行写成已完成能力。RDX lease / shader replace / replay 不得进入并发组。 |

### G. Knowledge

| | 裁决 |
| --- | --- |
| **当前态** | Knowledge Center 是 scoped Markdown 只读浏览。`KnowledgeBrowseService` 存在；五服务、七 lane、Candidate / Promote、ColdData import 均未实现。 |
| **目标态** | 五个主进程服务：`KnowledgeQueryService` / `KnowledgeIndexService` / `KnowledgeCompileService` / `KnowledgeCandidateService` / `KnowledgeWriteService`。七 retrieval lane：Identity/Path、Scope/Metadata、Lexical、Structural、Semantic、Relation/Graph、Temporal/Version。持久写入仅 human review。ColdData Historical Debug Case 经 canonical case card normalization 进入 session staging / Draft，**绝不默认或自动进入 Candidate**；`fixed ≠ verified`。仅当用户显式点击 / 命令，或 Agent 在本轮得到明确用户意图后显式调用 `knowledge_candidate_create`，才创建 Session Candidate。持久 Promote 仍只能 human review。canonical 仍是 `~/.rdx/knowledge` 或 `<project-root>/.rdx/knowledge`。本机原数据不入仓库；CI 只用脱敏 fixture。 |
| **迁移门禁** | 无自动抽取 / 自动 Candidate / 自动 Promote。`FullAccess` 不能绕过写入确认。旧 browse-only 路径在五服务落地后直接收敛，不保留第二套 resolver。`pnpm run check:knowledge-system` ratchet 已建立、目标债务未清零。 |

### H. Legacy 清理目标

实现目标拓扑时直接删除或改写，不得保留双轨：

- Ask / Plan / Edit 作为目标顶层身份、user seed 写入、`AgentCategory` 把 Mission 标成 general executable。
- 固定 Debugger harness stage、Classic Session Panel、`harnessTasks`、第二套 Hook（`AgentHooks` vs `HookEngine`）。
- 把 RDX catalog 展开为模型工具、把 RDX 做成 MCP、向 `TaskRecord` 加 capture/evidence 字段。
- 平台级 Investigation Graph、第二 TaskStore、Mailbox / Blackboard。
- 交互式旧 Profile 导出选择面、把 `AgentHandoffDefinition` 当成 durable 状态、把 embedding 并入 agent catalog。
- 目标三卡 Right Rail、把当前四卡写成最终契约、把未实现模块写成已完成。

## Right Rail Authority

Right Rail 有两个按选择对象区分的表面。选中 Project 时**只**渲染项目级 `Import .rdc` 输入面与已导入 capture 列表，永不读取 session runtime。

选中 Session 时：

- **当前态（Wave 迁移事实）**：四张不可折叠圆角卡 `Progress / Outputs / Context / Capture`。这是现有实现与 `check:right-rail` 的当前合同，不是最终产品形态。
- **目标态**：五张不可折叠圆角卡 `Progress / Artifacts / Outputs / Context / Capture`。Artifacts 只投影 main-owned Investigation Artifacts；Outputs 仍只接受 `output_register`；Capture 保留 scoped `.rdc` 选择、Replay Device、open / preview / refresh / copy / clear 与紧凑诊断。

两条状态下，main-owned `RightRailProjectionService` 都为显式 `{ projectId, sessionId }` 组装 `RightPanelViewModel`；renderer 只消费投影，不从 action events、全局 capture、工作目录扫描或 tool catalog 重建 Progress / Artifacts / Outputs / Context / Capture。Progress 是单一规范列表（`RightPanelViewModel.progress: ProgressTask[]`），创建序，已完成项就地保留，并与 transcript `taskProjection` 同序同态。Context 只含被冻结 Prompt 段或成功 tool result 证明的具体任务资源。Capture 在 session 中始终可见：诚实空态或 owner-session 操作面。Outputs 拒绝 inputs 与 plan。卡外壳在 empty / populated 之间不变；空内容用安静线框插图，有内容只增高本卡并在兄弟行间使用内部 hairline。Dock 在紧凑桌面宽度仍可用，仅在 `RIGHT_RAIL_DRAWER_BREAKPOINT`（920px）及以下或无法保住最小工作面时变为共享 overlay drawer。静态门禁：`pnpm run check:right-rail`。落地五卡后该门禁必须改认五卡，不得同时断言三卡、四卡与五卡。
