# RDC-Agent Design and Architecture Guide

`DESIGN.md` 是本仓库**产品边界、架构原则、权威地图与核心不变量**的裁决文件。若 `README.md`、`AGENTS.md` 或 `docs/**` 与本文件冲突，以本文件为准并同步修正其它文档。详细契约、产品规格与 UI 规范已分拆到 `docs/`，本文件只保留裁决层与索引，避免根目录堆叠运行时细则。

## Product Boundary

RDC-Agent 是通用 agent workbench，并一等公民支持 RDC/RDC 与 RenderDoc `.rdc`。它应能作为日常 agent 工作台完成阅读、规划、编辑、搜索、工具调用、handoff、memory 与 subagent 编排，同时保留 capture 打开、replay 上下文、RDC 原生操作、诊断与 RenderDoc 调查等垂直能力。

**发布面是 Windows-only。** `electron-builder.json` 只保留 `win`；mac/linux 安装包与公证不在产品范围内。POSIX launcher wrapper（`.sh`）仅供 Ubuntu CI 的 node 面准备，不是发布目标。Windows release 通道（`RDC_AGENT_RELEASE_CHANNEL=release` 或 git tag）必须提供 `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`（或 `CSC_*` 别名）；本地 `pnpm run pack` 保持不签名。SBOM 由完整 `pnpm-lock.yaml` 传递依赖图生成 CycloneDX，并记录 git SHA 与 lockfile digest。

**不做** image/video 生成 runtime、media provider 目录面或 `MediaRuntimeService` 类骨架；discovery 对非 agent modality（含 image/video output）保持 fail-closed 剔除。用户附件 vision-input（读图）仍属 agent chat 能力，与生成 media 无关。

产品不是固定模式向导。**四个 builtin 是唯一官方身份**：`general` / `debugger` / `analyzer` / `optimizer`（`resources/agent-runtime/agents`，scope 优先级 `builtin < user < project`，不再写 user seed）。user/project 只能覆盖这四个 id，或新增无关自定义 id。ask/plan/edit 及 S0 specialist id 为历史非法 id，不是顶层身份。仅 `user-invocable` 的 profile 出现在 composer orchestrator 菜单。`/plan` 不再硬切 builtin plan。Session rail 五卡 `Progress / Artifacts / Outputs / Context / Capture` 已落地。durable handoff 状态机已落地。三条 Mission 方法面已接到 Skill / Hook / Capsule（Debugger `$debugger-causal-method`，Analyzer `$analyzer-architecture-method`，Optimizer `$optimization-experiment`）。共享 `$rdc-tool-shell` 与 Debugger / Analyzer / Optimizer 三本 RDC 工具手册由 execute handoff 绑定给 General；它们只提供操作知识，权限仍由冻结 catalog、主进程策略与 owning lease 决定。Investigation 垂直 schema（`rdc.investigation.v1`）、`InvestigationArtifactService` 与三个 deferred 工具已落地；IPC `investigation:read` 已落地；15 个垂直方法 Skill 与 4 个 builtin Hook 模板已落地。Knowledge 目标拓扑是 markdown-first **六 lane**（Identity/Path、Scope/Metadata、Lexical、Structural、Relation/Graph、Temporal/Version）+ 五服务 + 五个 deferred 工具 + Knowledge Center 三列 UI；**禁止恢复 Embedding capability / Semantic lane**。`check:knowledge-system` / `check:investigation-system` 债务 allowlist 已空（hits=0）。**T18 知识导入 真实验收已证**（见下文 T18 已证组与 [`docs/product/acceptance-ledger.md`](docs/product/acceptance-ledger.md) `T18-colddata-*`）。产品级 Browser QA 全矩阵见 U05；U06 为历史运行事实；其中 Optimizer 的真实实验完成结论已撤回，不代表当前版本验收。裁决见下文「Current / Target / Migration Adjudications」。

唯一运行时路径是 agent loop：解析 profile / model route / policy / tools → 调用 LLM → 执行已批准工具 → 回灌结果 → 产出 final answer。Renderer 不得伪造推理阶段；隐藏 CoT 永不作为 UI 内容展示或持久化。

Agent loop 不能把“耗尽 turns”或“重复相同工具轮次”当作完成。`LoopProgressGuard` 对工具名、规范化参数、结果语义与 runtime revision 生成稳定指纹；连续第二轮无进展只注入一次不落盘纠偏指令，第三轮仍相同以 `AGENT_NO_PROGRESS` 终止。仍需 continuation 却达到 `maxTurns` 时以 `AGENT_MAX_TURNS_EXCEEDED` 终止。两者分别投影 `CONVERSATION_AGENT_LOOP_STALLED` / `CONVERSATION_AGENT_TURN_LIMIT_EXCEEDED`，不得归类成 Provider 请求失败。

## Architecture Principles

### 垂直能力收敛（2026-09-09）

本节裁决原生 CLI、会话权限与技能交接的统一边界。验收以实际证据为准。

- 原生 `rdc` 是唯一 CLI 协议，安装位置仍由本机 Settings 配置。应用 session id 不等于 replay session id；daemon context 必须绑定 owning session，不使用 default。probe 翻译为真实 argv，不发送 lease-open / lease-close / preview-status 假想命令。进程成功、canonical JSON ok:true 与 context 一致后才更新 lease。
- 四 Agent 身份不变。普通工作留在 General；RenderDoc Mission 走规划 → General 执行 → 原 Mission 评估。方法按需读取，skill_read 不改变当前轮权限；仅 prepareTurn 显式武装参与交集。执行方法不重复列举整个工作流权限，授权由 profile / policy / lease enforcement 决定。
- General 的 shell 接受互斥的普通 command 或结构化 RDC operation/args。后者经配置的原生 CLI、既有审批与 session lease，主进程生成执行回执；目录由同一个配置 CLI 发现；普通操作按冻结定义的能力校验，定向查询和单工具说明按需提供给模型。软件生命周期、remote 控制、全局设置、窗口与销毁操作仍由应用专门入口管理。
- prepareTurn 同时冻结 capture、replay 与 context 身份；只读 capture 能力使用主进程持有的身份。临时时间点查询须由主进程核对执行前后 context 与恢复结果，恢复失败隔离 lease，不刷新为查询中的临时画面。整帧证据校验 GPU 测量方法、完整范围、采样条件与 replacement，不接受事件总和或 CPU 耗时替代。
- 新关闭实验须有 baseline / intervention / variant / rollback / restored 的真实执行引用。模型声明、拒绝执行或普通 shell 回显不是已执行实验。旧记录保持可读、不自动追认；新完成判定按当前证据合同执行。
- 文档变更检查路径与术语；局部代码跑类型、lint 与受影响契约；集成收口跑全套 tests / coverage / gates / build 和必要 Browser QA。发布打包仅在发布配置受影响时执行。


1. **单一真相**：Session / Conversation / branch / journal 是会话历史权威；Agent slot 是执行配置与缓存，不是私有历史。
2. **冻结执行**：`EffectiveRuntimePlan`（`schemaVersion: 3`，含 `planId` / fingerprint 与完整工具/策略面）在 `prepareTurn` 冻结；Prompt 与 Executor 共用；在途 turn 不读可变 Settings。
3. **主进程权威**：权限、secret、MCP trust、Shell、RDC CLI、IPC 校验均在 `src/main`；preload / renderer / Browser Bridge 只暴露受控面。
4. **Scope 固定**：用户资源 `~/.rdc-agent`，项目资源 `<project-root>/.rdc-agent`（用户点保存的计划在 `plans/<sessionId>/`）；无配置 workspace root、无旧目录 fallback、无静默迁移。
5. **Provider 事实分层**：Manifest 是**基线真值**（baseline truth），Discovery 是**候选验证**（candidate validation），用户覆盖（`models.json`）是**显式覆盖，自带 provenance**（explicit override with provenance），三者合并为 EffectiveCatalog。模型/协议/控件基线事实只在 `src/shared/provider-catalog/manifests` 的严格 JSON；TS 只实现 Schema、compiler、Registry、Resolver、Planner、adapter、auth、discovery 与 user-override。用户覆盖禁止触及 route.protocol、authSchemaId、adapterId、compatibilityGroup、carrier 等安全/延续性字段。
   `catalogRevision` 只冻结 Effective Catalog 的可执行/可选择语义；刷新仅更新 provenance 时间戳时 revision 必须稳定，route、control、availability、quota 等有效语义变化时才更新。
6. **可取消与可回收**：Turn 经 `TurnCoordinator`（Session ownership：Active → Aborting → Orphaned → Settled；Orphaned 时 `beginTurn` fail-closed `TURN_ORPHANED`；`abortAndJoin` 等 stream terminal **与** producerCompletion）。子进程经 `ProcessSupervisor`；应用退出经 `ShutdownCoordinator`（`release_owned_runtimes` 先于 `terminate_processes`）；迟到 event 按 generation 丢弃。无 durable session 的 turn/slot 使用 ephemeral scope id（禁止 `__anon__` / `__no_session__`）。Conversation Stop 相位语义：`preparing` 干净撤销；`committing`/`running` 单调落停。Renderer 对 monotonic-stopped turn/request 丢弃迟到 `draft|streaming` patch。ProcessSupervisor 超时未观察到 close 时标记 `unconfirmed_orphan` 并保留 registry，禁止伪造已退出。归属 RDC daemon 必须 clear+stop 且有进程回执，失败不得假装已退出。
7. **失败有分类**：安全类 fail-closed；完整性 degrade-safe；可用性 recoverable。分类权威见 `docs/contracts/failure-model.md`。
8. **无 legacy 双轨**：新结构替代旧结构时直接收敛；默认不保留兼容 shim。
9. **对话模型**：Composer 底栏与 `/model` 选择的是**当前对话模型**，不写回 `.agent.md`。Settings 里的 Agent provider/model 只在用户还没点选时作为种子。未 override 是显式可选状态（菜单「按 Agent 配置」与 `/model default`）：有 session 时清除写入 `SessionRecord.modelOverride = null`，无 session 时清 Composer 草稿。Agent route 当前不可执行时禁止清除，避免把会话推进发送必失败的种子。`/model` 与底栏共用 EffectiveCatalog + `isAgentToolExecutableModel` 可选集；裸 `default` 先于 `provider:model` 解析，真名叫 `default` 的模型用 canonical `provider:model` 逃生。有 session 时写入 `SessionRecord.modelOverride`；无 session 时只记 Composer 草稿，首次发送随 `configurationCommit` 进入 `resolveAgentRoutePreflight` 并在 session 落地后粘性保存。切 Agent **不清**模型。父 session 模型 **不传** sub agent。Agent 可执行模型必须具备 source-backed `toolCalling.supported` 与已实现 structured-tool adapter；`unknown`/`unsupported` 不是选择项，已持久 override 或 Agent route 指向它们时 fail-closed 并给出同 provider 已验证候选项，禁止静默回退。Settings catalog 仍保留完整可审计记录。非法 model fail-closed，禁止静默回退 Agent 种子。
10. **Agent Shell**：命令工具 id 是 `shell`。解释器由 `ShellResolver` 解析（Settings `tooling.shell.executable` 本机覆盖 → 真实 pwsh 7 → Windows PowerShell 5.1；POSIX 优先 `$SHELL`（basename ∈ zsh/bash/sh/dash）→ `/bin/zsh` → `/bin/bash` → `/bin/sh`）。fish/csh/nu 等 fail-closed。全部失败抛 `SHELL_UNAVAILABLE`，不静默降级到 `cmd.exe`。POSIX 非交互走 login `-lc`；Windows 5.1 不改 `[Console]::OutputEncoding`，改用独立 UTF-8 writer，并显式 `$PSNativeCommandUseErrorActionPreference = $false`。每次调用 spawn 新进程，只用 GUID begin/trailer 回读 cwd；只持久化文件系统且位于 project root 内的 cwd 到 session `shell-state.json`，不存 env。旧 token `bash` 进入 `REJECTED_TOOL_TOKENS`，无展示别名、无静默映射。

## Authority Map

| 主题 | 权威位置 |
| --- | --- |
| 产品边界与本文件不变量 | 本文件 |
| 当前态 / 目标态 / 迁移门禁（Profile、Right Rail、Knowledge markdown-first / 六 lane、Handoff、Investigation、并发、Run schema v3、Mission plan-only、Hook trust、Mission 完成合同、legacy） | 本文件「Current / Target / Migration Adjudications」 |
| Verifier 结论落盘 | [`docs/product/acceptance-ledger.md`](docs/product/acceptance-ledger.md) |
| Runtime / Prompt / Provider / Tool / Session 契约 | [`docs/contracts/runtime-kernel.md`](docs/contracts/runtime-kernel.md) |
| Session Projection（active UI / 后台 cache / Composer 恢复） | [`docs/contracts/session-projection.md`](docs/contracts/session-projection.md) |
| Session `modelOverride`（所有权 / 冻结时机 / 不传子 agent） | 本文件 Architecture Principles §9；实现：`SessionRecord` + `resolveAgentRoutePreflight` |
| 权限、Bridge、Secret、MCP trust、Sandbox、CSP、IPC | [`docs/contracts/permissions.md`](docs/contracts/permissions.md) |
| Fail-closed 三分类与标注点 | [`docs/contracts/failure-model.md`](docs/contracts/failure-model.md) |
| Orchestrator façade 行数 / 职责外提 | 本文件 Invariant + `pnpm run check:orchestrator-facade` |
| Profiles / Skills / Hooks / Memory / RDC 产品规格 | [`docs/product/`](docs/product/) |
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
- **Tasks 能力真值**：Prompt 只描述 route 最终实际注入的工具。只读 route 仅可读 `task_list` / `task_get`；可写 route 仅在其冻结工具集确实包含 mutation 工具时才宣称可写。text-only route 不得列出、模仿或反复搜索 Tasks 工具。可写时 `task_create` 一次批量建全表；开工前仅一条 `in_progress`；完成后立即 `completed` 再开下一条；`blocked` 必须带 `statusReason`；单步或琐碎工作不建任务。
- **Tool search 无匹配**：返回 `NO_MATCH_IN_EFFECTIVE_TOOL_SET`、`authoritative: true` 与有效工具集 fingerprint；fingerprint 未变化时禁止重复同一搜索。
- **Capability unknown**：`toolCalling.state === unknown` → text-only，且不得进入 Agent/Composer 可执行集合；仅 `supported` 且具备已实现 structured-tool adapter 才 `native-structured`。`unsupported` 保持明确拒绝诊断，不得复用到 unknown。
- **输出通道**：`ProviderOutputRef` 一经声明永久归属 `thinking` | `text` | `tool_call` 之一；ref 必须承载 provider 侧 block 身份，已关闭的 block 不得复用，多 part / 多 item 必须映射到不同 ref；普通 assistant text 永不合成 thinking；仅 `final_answer` 写正文。
- **Secret**：`safeStorage` 不可用则 fail-closed；secret 不得进入 renderer / IPC 明文 / Trace / RequestPlan。
- **Browser Bridge (debug-only)**: only `RDC_AGENT_BROWSER_QA=1` (launcher browser/browser-dev) starts it. The authoritative entry is the one-time `/qa?qaBootstrap=...` URL printed by the launcher; successful bootstrap mints an HttpOnly `SameSite=Strict` cookie (with `Secure` for HTTPS) and redirects to clean `/app` on the **same bridge origin**. In `browser-dev`, Vite is reverse-proxied through the bridge (including HMR WebSocket); the browser never opens the Vite port and never carries bridge auth or a challenge in a URL query. Cookie-authenticated `/invoke`, `/events`, and `/api/*` require `Origin` equal to the bridge origin. Dev proxy strips `cookie` / `authorization` / `proxy-authorization` / `x-rdc-*` before forwarding to Vite. Programmatic clients may use an explicit Bearer header. Channel capability is a closed `Record<RendererInvokeChannel, BridgeChannelCapability>` in `src/shared/renderer-api/channelCapabilities.ts`; TypeScript forces every new channel to be classified; unknown channels fail closed. `high-impact` additionally requires `RDC_AGENT_BROWSER_QA_FULL_ACCESS=1`; `desktop-only` is always denied. Browser and Desktop share the single `src/shared/renderer-api` ElectronAPI factory and channel manifest. This surface is never part of the release default path. See docs/contracts/permissions.md and docs/architecture/browser-qa-surface.md.
- **MCP project**：同 ID 不可覆盖 user 的 command/args/url/env；变更需 `needsRetrust` + 显式 trust；运行时连接按 `projectRoot + descriptorHash` 建立独立 ref-counted pool，handoff 只属于当前 Turn terminal result。
- **RDC**：无内置 CLI 副本；Open `.rdc` 等垂直入口只走 Settings 配置的 CLI 与应用固定生命周期对接。Mission 只读面与 `rdc_probe` 见裁决 J。
- **外部解释器**：`code_interpreter` 只执行 Settings `tooling.codeInterpreter` 配置的本机解释器（默认探测系统 Python）；不内置运行时，不挂 `rdcCli`，未启用 fail-closed。产物经 `RDC_INTERPRETER_ARTIFACTS_DIR` 扫描登记。
- **`read_image`**：`visionInputMode !== 'native'` 时 `VISION_INPUT_UNSUPPORTED` fail-closed，与附件 vision 输入一致。
- **图像预览单通道**：工具图只经 session `image-previews` + `conversation:getToolImagePreview`（Zod + active-session gate）给 renderer；大 base64 不得进入 `resultPreview`。模型侧把 tool-result 图桥成紧随的 user image part，禁止静默丢图。用户附件缩略图走 `conversation:getAttachmentPreview`：staging 预览无 session；已提交附件必须带 `sessionId` 且过 active-session gate。
- **用户附件管道**：Composer `+` 只附加图片/文件（path 或 bytes 经 `conversation:stageAttachments`）。`.rdc`、可执行文件与 **SVG** 硬拒（SVG 不进 vision / inline）。Staging 写 `{userData}/state/staging/attachments/`，进程启动清空，preparing 失败不落 session。prepare 冻结最终 session 逻辑路径与 inline 文本；run 只补 image 字节。物化分层：image → native vision；text/pdf → tokenizer 预算 inline；binary → 元数据路径。当前 session `attachments/` 仅对 `read_file`/`read_image`/`glob`/`grep` 自动只读授权。禁止 `session:attachments:list` / `import` IPC。
- **session:// Artifact**：URI `session://<plans|investigation|tool-outputs>/<relative-path>` 只解析到 owning session 的 `<sessionPath>/session-artifacts/<category>/`。配额：单文件 2 MiB，artifact_read 返回窗 200 KiB / 2000 行，自动卸货阈值 32 KiB（序列化后），session 合计 96 MiB，tool-outputs 最多 256 文件；写入先对 incomingBytes（覆盖只计 delta）做 session 级 reservation，再 temp write / hash / atomic commit，失败回滚 reservation 并删除 temp；按磁盘 reconcile（丢弃未提交 reservation、清掉 `.tmp`）在启动 `initializeWorkspace`、session 打开/加载（`readSession` / `setCurrentSessionId`）以及 resolver 首次 read/write/list 时幂等执行；`artifact_read` 遇到卸货 envelope 时返回 payload 的 hash/size/mime 与 owner/source，不以 envelope 文件自身 hash 作为工具结果；MIME 白名单 text/plain、text/markdown、application/json、text/csv、text/yaml、image/png|jpeg|gif|webp；硬拒 SVG / 可执行 / `.rdc`。plans 活文件为 `session://plans/plan.md`（同意前覆盖写），同意后冻结为 `plan-<ISO>-<hash8>.md`；下一周期再写同一活文件。investigation 为调查记录。不进入 attachments 自动授权，`read_file` 不放宽。
- **Tasks 快照卡**：一轮只保留一张活的任务卡。canonical order 与派生状态由 main 侧 `taskProjection` 单点投影，transcript 与 Right Rail Progress 同序、同态、同副标题；点击定位靠 `data-work-process-task-id`。
- **Capture 所有权**：`ownerSessionId` 不匹配则 fail-closed；不得跨 session 继承已打开 capture。
- **唯一 Turn Preparation**：`sendMessage` / `sendProfileMessage` / Subagent 经 `ProfileTurnPreparation`（或 conversation `prepareTurn`）冻结 `preparedRuntime`；`AgentTurnRunner` 无 preparedRuntime 抛 `TURN_NOT_PREPARED`，禁止 fallback plan。
- **AgentState 复合键**：`sessionId|ephemeralScope` + `agentId`；renderer `agentStore` 与 IPC bridge 无 sessionId 的事件丢弃。
- **存储 fail-closed**：`StorageIo.readJson` / `readYaml` 区分 ENOENT(null)、损坏（quarantine + `STORAGE_CORRUPT`）与未知更高 `schemaVersion`/`schema_version`（`STORAGE_SCHEMA_UNSUPPORTED`，不 quarantine）。JSON store 经 zod runtime 校验；带版本的文档走 `schemaVersion → migration registry → 升级`。`attachments.json` 现写 `{ schemaVersion, attachments }`，已有纯数组仍按当前 Zod 形状校验；`usage.json` 现写 `{ schemaVersion: '2', usage }`；`context-view.json` 现写 `{ schemaVersion: '1', view }`，缺版本的裸 `DerivedContextView` 经 `SESSION_CONTEXT_VIEW_MIGRATIONS` 包一层；`session.json` / `attachments.json` / `run.json` / `run.yaml` 若带更高版本同样 fail-closed，缺版本仍按当前 Zod 形状校验。Settings 的 `rebuildPersistedSettings` 是该框架下的 settings 迁移实现，未知更高版本同样 fail-closed。写入走 atomic rename；`deepMerge` 拒绝 `__proto__`/`constructor`。Memory `.memory.lock` 与 Project `registry.json` 的 `.registry.lock` 共用 `directoryFileLock`：**活 pid 永不回收**，仅死 pid 或损坏锁文件可回收；Project registry 的 create/rename/remove/touch 读改写在同一把锁内。
- **Reasoning 续接**：`session-context.jsonl` 是 canonical 中性历史；`ContinuationReplayPolicy` 只按 compiled execution identity 决定同绑定回放 / 跨绑定 drop。切模型只改下一轮 route，不自动 compact，也不引入迁移事务、portable work state、workspace checkpoint。provider/model/protocol 变化且存在将被丢弃的 continuation 制品时，普通 Send 与 rewrite 都插入同一条 continuation-drop 系统通知。DeepSeek 带 tools 的 thinking-mode 协议要求跨轮回传 reasoning，对应 route 的 `artifactScope` 为 `all-assistant-turns`；`requirement: required` 的制品不受 8 轮 retention 过期，只随 compaction 边界终止。
- **结构化压缩**：仅自动压缩；产品不提供按钮、菜单、`/compact` 或 `/summary`。会话准备和执行途中复用 `PromptPlan → RequestEnvelope → adapter` 单轮、无工具的 model-generated `StructuredHandoff`（`derivation: 'model-generated'`）。LLM 失败显式报错（Availability recoverable），不静默回退确定性抽取。低于阈值或可见回合过短时返回 `status: 'noop'`，不写 `complete` 压缩工作块。
- **MCP transport**：仅 `stdio` / `streamable-http`；`sse` 配置 fail-closed（`MCP_TRANSPORT_UNSUPPORTED`）。Pool identity：`realpath + projectId + descriptorHash`；失败缓存指数退避；orphan pool quarantine。
- **ToolValidator**：严格 JSON Schema 子集；只接受 `SUPPORTED_SCHEMA_KEYS` 白名单；未声明字段与未实现关键字编译期 `UNSUPPORTED_TOOL_SCHEMA` fail-closed。
- **Orchestrator façade**：`AgentOrchestrator.ts` 保持 façade（**少于 800 行**）；turn 准备、tool 装配、executor、turn/subagent runner、prompt-plan、memory UI 等职责外提到协作单元；门禁 `pnpm run check:orchestrator-facade`（亦挂在 `check:architecture`）。
- **CSP**：生产 `script-src` 无 `unsafe-inline`；`style-src 'self'`（无 `unsafe-inline`）；`style-src-attr 'none'`；动态样式经 constructable stylesheet（`useDynStyle` / `assignDynStyle` / Appearance `applyChromeTheme`），禁止依赖 inline style attributes 或 `<style>` textContent 注入。Appearance chrome 权威见 [`docs/ui/design-system.md`](docs/ui/design-system.md)；`chromeThemes` 由 Settings `schemaVersion` **6** 起在升级时硬重置为 RDC 默认（不可逆，清历史污染）。
- **IPC Zod**：全部 IPC handler 经 `parseIpcArgs`；非法 payload fail-closed；`approvalToken` 单次消费。
- **RDC context lease**：仅 per-session lease（`setRdcRuntimeContextForSession` / `getRdcContextLease` / `assertRdcContextLeaseOwnership`）；**禁止** RDC global mirror、`legacyGlobalMirror`、`getRdcRuntimeContext` 全局 API。
- **Session Projection**：主进程允许多 session 并行 turn；renderer 仅投影 `currentSession`；带 `sessionId` 的 IPC 流式/投影事件必须经 active-session gate，后台写入 `sessionProjectionStore`；Composer draft 恢复与 Stop/Rewrite monotonic 绑定 owning session/`requestId`。权威见 [`docs/contracts/session-projection.md`](docs/contracts/session-projection.md)；门禁 `pnpm run check:session-projection`。
- **EffectiveRuntimePlan**：`schemaVersion: 3`；在 `prepareTurn` **完整冻结**（`planId` / fingerprint / tools / skill ∩ / deferred / MCP hash / permission / policy / `contextCompactionPercent` / route / request+prompt fingerprints / 附件 manifest 指纹）；Prompt 与 Executor 共用；在途 turn 不读可变 Settings。
- **上下文预算**：`contextTierPromptCap` = `maxPromptTokens ?? maxTotalTokens`，不扣模型输出上限。压缩触发为 `min(用户 compactionThresholdPercent, policy.contextCompactionPercent)`（policy ≥100 不约束；结果 clamp 50–90 / 步长 5）。规划上限走 `resolvePlanningOutputTokens`（声明值 / 拆窗差值 / 窗口本身）。每次 LLM call 的 `max_tokens` = `min(规划上限, window − promptTokens − safety)`；缺省输出上限 = 剩余窗口，禁止把缺省写成 0。装不下先压缩再 `CONTEXT_CANNOT_FIT` fail-closed。

## Document Index

### Contracts

- [`docs/contracts/runtime-kernel.md`](docs/contracts/runtime-kernel.md) — Agent loop、Prompt/Request、Reasoning、Tools、Session、Model capability
- [`docs/contracts/session-projection.md`](docs/contracts/session-projection.md) — Active Session Projection、IPC gate、Composer 恢复、Stop/Rewrite monotonic
- [`docs/contracts/permissions.md`](docs/contracts/permissions.md) — Permission mode、Sandbox、CSP、IPC Zod 全量、Bridge、Secret、RDC lease、MCP trust、Shell
- [`docs/contracts/failure-model.md`](docs/contracts/failure-model.md) — Security / Integrity / Availability

### Product

- [`docs/product/scoped-runtime-resources.md`](docs/product/scoped-runtime-resources.md) — Scope、Profiles、Skills、Hooks、Memory、Project Instructions
- [`docs/product/vertical-debugger-overview.md`](docs/product/vertical-debugger-overview.md)
- [`docs/product/renderdoc-agent-complete-design.md`](docs/product/renderdoc-agent-complete-design.md) — 受本文件裁决的详细目标设计；目标态未全部实现
- [`docs/product/acceptance-ledger.md`](docs/product/acceptance-ledger.md) — Verifier 结论落盘（U00–U07 / T18）
- 其它：`docs/product/README.md`

### UI

**视觉定位（裁决）**：RDC-Agent 是 restrained、高密度、实色分层的精密工具，参照 VS Code / JetBrains / Linear 的信息密度与克制程度。每一处视觉选择都服务于聚焦与快速研判：不使用装饰性动效或插画；层次由 1px 边框与实色表面建立，阴影只用于 popover 与 modal。backdrop blur 只允许用在模态全屏遮罩（`--modal-backdrop` + `--modal-backdrop-filter`），把注意力压到弹层上；Dropdown / popover / chrome 仍为实色，禁止装饰性毛玻璃。单一 accent 只承担 focus / selected / primary CTA。该定位是 `docs/ui/design-system.md` 全部刻度的上位依据，冲突时以本段为准。

**渲染层分层（裁决）**：`ui`（无业务原子/分子组件）→ `patterns`（跨 feature 复合，可读 store，不写 store、不直调 IPC）→ `features`（产品面，禁止横向 import 其它 feature）→ `app` / `shell`（编排与窗口 chrome）。`stores` / `services` / `hooks` / `lib` / `platform` 为被依赖层，不得反向 import `features` / `ui` / `patterns` / `app` / `shell`。组件（`.tsx`）不得直调 `window.electronAPI`。门禁：`pnpm run check:renderer-structure` + ESLint `no-restricted-imports`。

**Token 合规（裁决）**：组件 CSS 只允许语义 token 与刻度变量；primitive `--color-*`、hex 字面量、px 字号 / 间距 / 圆角、`!important` 一律禁止。`backdrop-filter` 禁止字面量 `blur(...)`；模态遮罩只能写 `var(--modal-backdrop-filter)`。豁免仅限 token 定义层与全局 chrome 层。门禁：`pnpm run check:design-tokens`。受门禁锁定的 renderer 文件路径集中登记在 [`scripts/fidelity/renderer-contract.json`](scripts/fidelity/renderer-contract.json)。

**渲染层目录（裁决 / 目标态）**：

```
src/renderer/
  app/            App、bootstrap、WorkbenchShell、theme、overlays、contextMenu
  shell/          AppShell、TitleBar、ResizeHandle、UserMenu
  features/
    transcript/   消息、Work Process（形态不变）
    composer/     Composer 与共置 CSS
    right-rail/   Session / Project 右侧栏
    sidebar/      Project / Session 列表
    settings/     八 section，CSS 共置
    knowledge/    Knowledge Center
    terminal/     终端面板
    captures/     DeviceSelector 与 capture 入口
  patterns/       跨 feature 复合（含 Markdown），可读 store，不写 store、不直调 IPC
  ui/             原子 + 分子组件库
  stores/  services/  hooks/  lib/  platform/
  i18n/           index.ts + locales/{en,zh-CN}/<feature>.ts
  styles/         design-system.css、global.css、base.css、responsive.css（仅真 @media）
```

禁止恢复 `pages/`、`styles/tokens/*`、`styles/base/`、`src/renderer/components`。B3 已迁到本树；不得双轨。

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

本地 / CI（`.github/workflows/ci.yml`）必跑：`check:repository-hygiene` → `typecheck` → `lint` → `test` → `test:coverage` → `check:coverage-ratchet`（只升不降；基线 `scripts/fidelity/coverage-ratchet.json`）→ `check:architecture`（含 Orchestrator &lt;800 与 main 单文件 ≤900）→ 全套关键 `check:*`（含 `check:design-tokens` / `check:renderer-structure` / `check:browser-capability` / `check:release-config`）→ `check:contracts` → `build`。并行：`browser-smoke`（Windows + smoke:agent-browser，矩阵 `RDC_AGENT_BROWSER_QA_FULL_ACCESS` 0/1）、`desktop-smoke`、双 OS（ubuntu/windows）`launcher-fresh-checkout`/`pack`（Linux 上 SBOM/checksum）。

UI/工作流用 `pnpm run start:agent-browser` 真实会话验收（先停旧进程、删光 QA project 全部 session、再新建隔离 session）。完整清单见 `AGENTS.md`。

**Provider 失败诊断保真**（契约见 [`docs/contracts/failure-model.md`](docs/contracts/failure-model.md)「provider 失败诊断保真」）：`ProviderEmptyStreamError`（`PROVIDER_STREAM_EMPTY`）不得合成 HTTP 502；`ErrorRecovery` 的 `empty_stream` 最多 1 次重试，真实 5xx 仍为 `server_error`（3 次），503 仍为 `overloaded`，401 立即 abort；`AgentRecoveryAbortError` 必带 cause 与结构化字段；`createTurnFailedDiagnostic` 保留 `CONVERSATION_LLM_REQUEST_FAILED` 并按 auth / quota-rate / 5xx / empty_stream / network 分类文案。自动化：`ErrorRecovery.test.ts`、`ConversationTurnDiagnostic.test.ts`、`providers/internal/http.test.ts`、`OpenAIResponsesProvider.test.ts`、`AgentLoop.recoveryDiagnostic.test.ts`；Work Process Active Signal 与诊断行对齐见 `check:work-process` + [`docs/ui/work-process-checklist.md`](docs/ui/work-process-checklist.md)。

Settings `schemaVersion` **6**：升级时不可逆重置 `appearance.chromeThemes` 为 RDC 默认（清理历史污染）。桌面窗口几何写入 `layout.window`（宽高/坐标/最大化），主进程在 resize/move/close 时持久化并在启动恢复；左右栏与 terminal 高度仍经 renderer `settings:set` 持久化。Browser 与 Desktop 走同一 Settings 持久化路径；Browser QA 默认使用经过校验并在退出清理的 disposable `os.tmpdir()/rdc-agent/qa-*` userData，只有显式 `RDC_AGENT_USER_DATA` 或 `RDC_AGENT_USE_CANONICAL_USERDATA=1` 才共享 canonical userData，`instance.lock` 阻止并发占用。

## Current / Target / Migration Adjudications

本节是 Wave 0 原子裁决。凡写「当前态」即仓库现有实现；「目标态」即后续 Wave 必须收敛到的单一路径；「迁移门禁」是实现该目标时的数据/契约约束。目标态未实现前，不得把目标模块写成已完成，也不得为旧路径增加兼容双轨。详细字段与领域流程见 [`docs/product/renderdoc-agent-complete-design.md`](docs/product/renderdoc-agent-complete-design.md)；该文件受本裁决约束，不是第二产品权威。

非侵入硬约束（当前态与目标态共同成立）：

- 不新增平台级 InvestigationGraph、第二 TaskStore 或第二 Agent Runtime。
- `TaskRecord.metadata`、`AgentProfile.metadata`、`ConversationMessage` 禁止领域字段；垂直记录只能引用 task id。
- 不把 RDC 操作集合注册成独立模型工具，不把 RDC 做成 MCP。RDC 仍是外部 CLI，无内置副本。**General** 通过 Settings 配置的 CLI 与结构化 `shell.rdc-agent` 执行需要 lease 的 Live RDC 操作。**Mission planner（debugger/analyzer/optimizer）禁止 `shell` 与 `code_interpreter`**；只通过受控只读 `rdc_probe` + `rdc_context`（lease 状态）访问 RDC。
- Knowledge 持久写入仅 human review；`FullAccess` 不可绕过；无自动 Memory / Knowledge / Candidate / Promote。
- 新结构替代旧结构时直接收敛；默认不保留 legacy / deprecated shim。
- **禁止恢复** Embedding capability / Semantic lane / `settings.llm.embedding` / `EmbeddingCatalog` / `EmbeddingExecutionService`。Discovery 对 embedding/embeddings modality 继续 fail-closed 剔除。
- **禁止恢复** ask/plan/edit 或 S0 specialist id 的运行通道、custom manifest fallback。

### A. Builtin Profiles

| | 裁决 |
| --- | --- |
| **当前态** | 官方文件只存在于 `resources/agent-runtime/agents`：`general`（Execution Orchestrator）、`debugger` / `analyzer` / `optimizer`（Planning Orchestrator）。生效优先级 **`builtin < user < project`**，整资源替换，builtin 属性由 scope 派生。运行时**不再写 user seed**。Settings / Composer / Conversation preflight 共用 project-aware effective snapshot。`handoffs` 可省略或显式空（合法=禁止 handoff）；任一畸形 entry 使整个 candidate invalid。空 `agents` 仅允许 self delegate。`AgentId` / `TOP_LEVEL_AGENT_IDS` 只含四 builtin。Run **当前为 v3**（`kind: conversation\|mission` + `profileId`，无 `mode` / `lastStage` / `workflow_stage`）；见裁决 I。**代码诚实**：seed 迁移是 v2 marker（`~/.rdc-agent/agents/.seed-migration.json` `schemaVersion:'2'`，含 `ruleVersion` / `directoryContentHash` / `actions[]`）。canonical hash 只排除顶层 `models` / `icon` / `accent` 与 `handoffs[*].model`。v1 marker 视为未完成并重跑；更高版本 fail-closed 不动文件。ask/plan/edit 及 S0 specialist id 不进入 effective snapshot，诊断 `AGENT_ID_RESERVED_HISTORICAL`。 |
| **目标态** | 只有四 builtin：`general` / `debugger` / `analyzer` / `optimizer`。user/project 只能覆盖这四个 id，或新增无关自定义 id。ask/plan/edit 及 S0 specialist id 为历史非法 id：候选进入 `ScopedResourceResolver` / `AgentManifestService` 时剔出 effective snapshot，并诊断 `AGENT_ID_RESERVED_HISTORICAL`（Settings > Agents 诊断区可见；project 只诊断不自动删）。**不再有 custom manifest 运行通道**，也不再把 ask/plan/edit 当顶层身份或运行时 fallback。不新增 `mission` / `orchestratorType` / `investigationMode` 等 Profile 领域字段。durable handoff、三条 Mission 方法面、Investigation schema / Service / 工具、15 个垂直方法 Skill、4 个 builtin Hook 模板与 Session rail 五卡已落地。产品级 Browser QA 全矩阵见 U05 / [`acceptance-ledger.md`](docs/product/acceptance-ledger.md)。 |
| **迁移门禁（U01 落地）** | 历史官方 seed 世代诚实编号为 S0–S9（从 git 历史抽出，不编造）。canonical hash **只排除**顶层 `models` / `icon` / `accent` 与 `handoffs[*].model`；`handoff.agent/prompt/send/showContinueOn`、顺序、metadata、instructions、tools、skills、agents 全部参与。marker `~/.rdc-agent/agents/.seed-migration.json` `schemaVersion:'2'`（含 `ruleVersion` / `directoryContentHash` / `actions[]`）；v1 视为未完成，在目录锁内重跑一次并原子替换为 v2；更高版本 fail-closed 不动文件。崩溃恢复用 isolation manifest（隔离目录 + 每文件 hash），损坏/未知 fail-closed，不静默丢文件。规则：id ∈ {ask, plan, edit} ∪ S0 specialist → `purged-historical`；id ∈ 四 builtin 且 canonical hash === 当前 builtin → `purged-shadow`，否则 `retained-override`；其它合法 id → `retained-custom`；文件名/frontmatter id 不一致 → `invalid-id` 保留 + 诊断。官方未改 seed **最终不再存在**，不留 `.migrated` 备份。禁止交互式「导出 / 保留 / 移除」选择面。 |

### B. Right Rail

| | 裁决 |
| --- | --- |
| **当前态** | Project rail 只有 `Import .rdc` 与已导入列表。Session rail 是五张不可折叠卡：`Progress / Artifacts / Outputs / Context / Capture`。`RightRailProjectionService` 单轨投影；renderer 不重建。Artifacts 只投影 main-owned `rdc.investigation.v1`。Outputs 只认 `output_register`。IPC `investigation:read({ sessionId, artifactId, expectedHash })` **已落地**；`InvestigationArtifactRow` 携带完整 `contentHash`（renderer 只缩显）。产品级 Browser QA 全矩阵见 U05 / ledger，不得写成已验收，也不得再写「读取通道尚未补齐」。 |
| **目标态** | 与当前态相同（读取通道已落地）。Project rail **仍只有** `Import .rdc`，不读 session runtime。Artifacts 是 main-owned Investigation Artifacts（垂直 Session Artifact 投影，不是 Working Directory 扫描，也不是 `output_register`）。Renderer 读取 Investigation 正文的唯一通道是 IPC `investigation:read({ sessionId, artifactId, expectedHash })`（分类 `read`；active project/session owner gate；内部唯一调用 `InvestigationArtifactService.readRecord`；只返回既有 max-bytes 内完整 record，超限 fail-closed；不接受 URI / 绝对路径 / generic artifact）。`InvestigationArtifactRow` 必须携带完整 `contentHash`（renderer 只缩短显示）。Outputs 仍只展示 `output_register` 发布的用户输出文件。Capture 保留现有所有权与 Replay Device 面。Progress 仍消费 canonical `taskProjection`。五卡外壳在 empty / populated 之间不变。单轨投影与「renderer 不重建」不变。 |
| **迁移门禁** | Session rail 只承认五卡一套契约，禁止再把三卡或四卡写成现行合同。门禁走 `pnpm run check:right-rail`，必须覆盖 Artifacts 卡与跨卡所有权。 |

### C. 已废止：Independent Embedding Capability

| | 裁决 |
| --- | --- |
| **当前态** | Embedding capability 与 Semantic lane **已删除**。Knowledge 走 markdown-first 六 lane（见裁决 G）。Settings schema 7 不再持久化 embedding 选择。Discovery 对 embedding / embeddings 等非 agent modality **继续** fail-closed 剔除。Embedding 模型不进入 Agent / Composer / subagent picker。真实 OpenAI embed **不再补跑**（U02 已删除 Embedding）。 |
| **目标态** | 保持删除。禁止恢复 Embedding capability / Semantic lane / `settings.llm.embedding` / `EmbeddingCatalog` / `EmbeddingExecutionService`。Discovery 对 embedding/embeddings modality 继续 fail-closed 剔除。 |
| **迁移门禁（U02 落地）** | `check:knowledge-system` 为六 lane + `forbidden.embedding-runtime` 零命中。Settings schema 7 一次性删除 embedding 选择；`>7` fail-closed。不得把「未跑真实 OpenAI embed」写成仍待验收的产品缺口。 |

### D. Declared Continue and Execution Offer

| | 裁决 |
| --- | --- |
| **当前态** | `AgentHandoffDefinition` 只是 Copilot 式 UI 声明（label / agent / prompt / send / showContinueOn / requiredSkillIds）。人点建议行或计划门后，主进程 `applyDeclaredHandoff` 触发 `agent.before-handoff` / `after-handoff`，写入 `<sessionPath>/execution-offer.json`，并 persist `session.agentId`。`send: true` 只表示点完后预填并自动发送。不存在 `agent_handoff` 工具，也不存在 `prepared → committed → consumed` 状态机。打开会话时若仍有 `handoff-state.json`，只 unlink，不 parse。 |
| **目标态** | 与当前态相同。计划批准写入 offer（source / target / 冻结 plan.uri+hash / 声明 requiredSkillIds）。prepareTurn 仅当本回合 `agentId === targetAgentId` 且 session 批准计划与 offer 同 hash 时预载 Skill。General 就地终答，不自动回 Mission。用户用 Agent pill 或历史建议行切回 Mission。Pill 切换不写 offer、不预载调查 Skill。空 `handoffs` 合法（General 无按钮）。`handoff` / `agent` / `agent_handoff` token 拒绝，不静默映射到 `subagent`。 |
| **迁移门禁** | 禁止恢复 `agent_handoff`、`HandoffStateStore`、强制 return 或 dual-read 旧 `handoff-state.json`。 |

### E. Investigation Vertical Schema

| | 裁决 |
| --- | --- |
| **当前态** | `rdc.investigation.v1` 垂直 Session Artifact 强 schema、Kind Registry、四大不变量机器判定、`InvestigationArtifactService` 与三个 deferred 工具（`investigation_read` / `investigation_write` / `investigation_list`）已落地。15 个垂直方法 Skill（含 Debugger `debugger-causal-method` 与 Analyzer `analyzer-architecture-method`）与 4 个 builtin Hook 模板已落地（按需 `$skill`，不预装进 `.agent.md`）。三条 Mission 方法面已接到 Coordinator / 方法 Skill / `mission-plan-handoff-check` / `report-contract` / Delegation Capsule 纪律。Analyzer `claimKind` 不得越 Observed / Reconstructed / Authoring 层；Optimizer 无 rollback 的 mutate 不得关闭。记录只写 session-owned Session Artifact；不存在平台级 Investigation Graph。Session rail 五卡已落地，Artifacts 只投影该 namespace。仓库只用脱敏 fixture。**事务已落地**：record / manifest / index / supersede / stale-propagation 经 journal / temp-set / commit marker / atomic replace 同一事务；启动恢复只见完整旧版或完整新版；损坏/部分事务显式 `degraded`，不伪装 empty。**完成合同已落地**：Mission 正常 `completed` 经 turn 收口门禁（可解引用 `MissionCheckpoint` + `kind=report`/`status=ready` + 完整章节 + canonical `final_answer` 引用）；Partial / Inconclusive / Blocked 不得伪装 completed。IPC `investigation:read` 已落地；投影携带完整 `contentHash`。T18 知识导入 已证见下文已证组。产品级 Browser QA 全矩阵见 U05；U06 仅保留历史运行事实；Optimizer 真实实验结论已撤回，见 ledger 更正。 |
| **目标态** | 混合 schema namespace `rdc.investigation.v1`，**只**存在于垂直 Session Artifact：`WorldState`、`EvidenceRecord`、`ClaimRecord`（Hypothesis 是 `claimKind`，Decision 内嵌）、`ExperimentRecord`、`ChallengeRecord`、`MissionCheckpoint`、`InvestigationArtifactManifest`。记录必有稳定 id（`claimId` / `experimentId` / `challengeId` / `artifactId`）；causal / counterfactual Claim 必须带可解引用 `experimentId`。系统不变量 `S-CTX-01` / `S-STATE-01` / `S-CLAIM-01` / `S-CAUSAL-01` / `S-KNOW-01` / `S-KNOW-02` / `S-RDC-01` 在该 schema 上做机器判定。认识论偏序 `unknown < inferred < derived < observed`；Confidence 与 Verification 分离。`ready` 必须结构化 `sourceRefs`（`{ artifactId, expectedHash }`）`>= 1`、各 `expectedHash` 与源当前 sha256 匹配、`contentHash` 等于 `contentRef` 正文字节 sha256、`kind` 经闭集 Registry 解析到 `recordType + schema` 且正文通过；旧版本标 `superseded`。compact / report / view 投影 Claim 必须带 `compactProvenance`，否则违反 `S-CLAIM-01`。`S-RDC-01`：mutate 必有 Experiment + exclusive world state + rollback / restored 验证，否则 `polluted` / `stale`。`S-CAUSAL-01`：causal / counterfactual Claim 必须引用**可解引用**的 `ExperimentRecord`，且该实验 `intervention.type != none`、`status ∈ {recorded, rolled_back}`、`rollback.executed === true`、`rollback.baselineRestored === true`、并存在 verify evidence（三者均须满足）。record / manifest / index / supersede / stale-propagation 必须同一事务（journal / temp-set / commit marker / atomic replace）；重启恢复只能看到完整旧版本或完整新版本；损坏/部分事务显式 `degraded`，不得伪装 empty。Renderer 读取正文的唯一通道是 `investigation:read`（见裁决 B）。Mission 正常 `completed` 见裁决 L。字段细则见详细目标设计。 |
| **迁移门禁** | 禁止把上述字段写入 `TaskRecord` / `AgentProfile` / `ConversationMessage`。垂直记录只能引用 task id。禁止新建平台级 Graph Service。`pnpm run check:investigation-system` ratchet 已建立；schema / Service / contract suite / 五卡已清零，15 Skill / 4 Hook 已落地，三条 Mission 方法面已接到 Skill / Hook / Capsule，债务 allowlist 已空（hits=0）。T18 知识导入 已证见下文已证组。产品级 Browser QA 全矩阵见 U05；U06 仅保留历史运行事实；Optimizer 真实实验结论已撤回，见 ledger 更正。 |

### F. Concurrent Tools

| | 裁决 |
| --- | --- |
| **当前态** | `AgentTool.spec.isConcurrencySafe` 缺省 `false`。`ConcurrentToolScheduler` 只并发同轮连续安全组；unsafe 独占。`shell` / write / task mutation / RDC / MCP / ask / `output_register` 与 `domainExtensions.rdc-agent.requiresLease=true` 的 subagent 串行。offline subagent（未请求 `domainExtensions.rdc-agent`）可进并发组。dispatch 前 `reserveDispatchBudget` 原子扣减；失败整组不开。结果按 `callIndex` 回填；部分失败不连坐已发出调用；abort `allSettled` join。**delegated lease 已落地**：`grantDelegatedLease` / `revokeDelegatedLease`；`domainExtensions.rdc-agent.requiresLease=true` child 在 turn 前取得 parent 上下文副本（`delegatedFrom`），同一 parent 同时只允许一条 live delegated lease，无 parent lease 则 fail-closed；child 完成 / 取消 / 抛错在 `finally` 立即撤销，parent lease 不变。未请求 `domainExtensions.rdc-agent` child 在 allowlist 编译期剔除 `rdc_context` / `rdc_probe`（`shell` 可保留，但不继承 parent lease）。产品级 Browser QA 全矩阵见 U05 / ledger。 |
| **目标态** | 并发缺省不安全：只有 `AgentTool.spec.isConcurrencySafe === true` 才安全，缺省 `false`。只并发**连续**安全组；unsafe 独占。`shell` / write / task mutation / RDC（含 `rdc_probe`） / MCP / ask / `output_register` 串行。`callIndex` 保持稳定顺序。dispatch 前原子扣减预算。abort 必须 `allSettled` join。部分失败不连坐同组其余已发出调用的结果记录，但不得继续开新组。offline subagent 不请求 `domainExtensions.rdc-agent`。`domainExtensions.rdc-agent.requiresLease=true` 的 child 必须通过显式、受限、生命周期绑定的 delegated lease 取得 parent RDC context 并串行；child 完成/取消立即撤销。未请求 `domainExtensions.rdc-agent` 的 child **在 allowlist 层**就不能拿到 `rdc_context` / `rdc_probe` / `shell` 中的 RDC 路径（不是运行时再报错）。禁止并发 RDC 双 owner。 |
| **迁移门禁** | 实现前不得把并发执行写成已完成能力。RDC lease / shader replace / replay 不得进入并发组。 |

### G. Knowledge

| | 裁决 |
| --- | --- |
| **当前态** | 五服务已落地于 `src/main/knowledge/`。五个 deferred 工具 `knowledge_browse/search/read/compile/candidate_create` 与 canonical `knowledge` token 已注册；`$knowledge-scout` / `$knowledge-candidate` 已作为 builtin Skill。Knowledge Center 三列 UI（Spaces / List / Detail）已落地，IPC 只映射五服务，browse-only channel 已删除。Candidate/review 已落到 session durable store（`<sessionPath>/knowledge-state.json`，跨进程锁 + revision）；导入草稿不再写入该文件。知识导入 bounded path ingest 记录并复核源 hash/mtime/size，经 `KnowledgeImportService` + `WriteService` 写入所选 user/project 空间 draft，Cards 可读；human-confirm 写入经 realpath + 原子替换。导入点击在同一次处理里签发并消费 `knowledge.write` token，不另弹写入确认窗。**代码诚实**：源码已是 markdown-first 六 lane；Embedding capability / Semantic lane 已删除。**T10 一致性已落地**（五服务 / 五工具 / 两 Skill / Center IPC 读同一 durable 事实：Candidate/review → `KnowledgeDurableStore`；卡片正文/index → space markdown + `KnowledgeIndexService`）；deferred 工具遵守真实 caller 与 skill 交集。**T18 知识导入 真实验收已证**（2026-09-03 历史）：两份桌面案例经当时的 `knowledge:import` 进 session Draft（`candidateCreated: false`，`sourceStatus: fixed`，`verified: false`，源 hash 与磁盘一致），再经 `issueApprovalToken` + `write` 落到 `~/.rdc-agent/knowledge/cases/AIRD-20260207-000{1,2}.md`；Knowledge Center 显示 User space 2、中文标题完整；`knowledge:query` 词法命中「发黑」。现行导入不再使用 session inbox：点导入即写入目标空间 draft，同源 `sourceHash` 幂等，不同源同 ID 为导入冲突且不进 Conflicts 页。真实 OpenAI embed **不再补跑**（见裁决 C / ledger `T18-semantic`）。产品级 Browser QA 全矩阵见 U05。 |
| **目标态** | 五个主进程服务：`KnowledgeQueryService` / `KnowledgeIndexService` / `KnowledgeCompileService` / `KnowledgeCandidateService` / `KnowledgeWriteService`。**六 retrieval lane**（markdown-first）：Identity/Path、Scope/Metadata、Lexical、Structural、Relation/Graph、Temporal/Version。**禁止** Semantic lane / Embedding capability。canonical knowledge 读根 `realpath(~/.rdc-agent/knowledge)` + `realpath(<projectRoot>/.rdc-agent/knowledge)` 对 `read_file` / `read_image` / `glob` / `grep` 免审批（**U02 落地**）；写入仍经 `knowledge_*` + human review。单一事实源：`knowledge_*` 由 main-owned `KnowledgeIndexService` 提供；grep/glob/read 只是补充证据；禁止第二索引或 renderer 事实源。持久写入仅 human review。durable canonical store（user `~/.rdc-agent/knowledge` 与 project `<项目>/.rdc-agent/knowledge`；会话不是知识库，只存 Candidate/review）；知识导入 bounded read 经 WriteService 原子写入所选空间 draft，无 raw 长期副本、无 session inbox；记录并复核源 hash/mtime/size；index revision 绑定 content hash。知识导入 Historical Debug Case 经 canonical case card normalization 写入目标空间 draft，**绝不默认或自动进入 Candidate**；`fixed ≠ verified`。仅当用户显式点击 / 命令，或 Agent 在本轮得到明确用户意图后显式调用 `knowledge_candidate_create`，才创建 Session Candidate。持久 Promote 仍只能 human review。本机原数据不入仓库；CI 只用脱敏 fixture。Knowledge Center 的导入 / 导出 / 写入确认是叠加在三列之上的任务子弹窗，不替换阅读区。导出经 `KnowledgeExportService` + `knowledge:export`（high-impact），格式为可再导入的知识包 `rdc.knowledge-package/1` 或阅读用途 Markdown；导出剔除 `sourceHash` / `sourceMtimeMs` / `sourceSize` 与绝对路径，复用导入同一套 secret 扫描，禁止导出凭据、provider 配置与会话数据；知识包再导入一律落目标空间 draft（`verified: false`）；同源 `sourceHash` 幂等「已在该空间」，不同源同 ID 为导入冲突并带标题/已有 `cardId`，不并进 Conflicts 页。包内 `lifecycle` 只是元数据，绝不自动认作目标环境已验证。 |
| **迁移门禁** | 无自动抽取 / 自动 Candidate / 自动 Promote。`FullAccess` 不能绕过写入确认。旧 browse-only 路径已删除，不保留第二套 resolver。U02 重写 `pnpm run check:knowledge-system`：六 lane + `forbidden.embedding-runtime` 零命中；继续覆盖 durable store、无 Candidate/review Map、知识导入写入空间 draft 且不自动 Candidate、`fixed ≠ verified`、五工具 deferred；债务 allowlist 保持 hits=0。**T18 旧桌面证据保留为历史；现行空间落盘 + Cards 可见见 ledger 本轮条目，不得把 T18 写成尚未发生。** |

### H. Legacy 清理目标

实现目标拓扑时直接删除或改写，不得保留双轨：

- Ask / Plan / Edit 作为目标顶层身份、user seed 写入、`AgentCategory` 把 Mission 标成 general executable。
- 固定 Debugger harness stage、Classic Session Panel、第二套 Hook（`AgentHooks` vs `HookEngine`）。
- 把 RDC catalog 展开为模型工具、把 RDC 做成 MCP、向 `TaskRecord` 加 capture/evidence 字段。
- 平台级 Investigation Graph、第二 TaskStore、Mailbox / Blackboard。
- 交互式旧 Profile 导出选择面、把 `AgentHandoffDefinition` 当成 durable 状态、把 embedding 并入 agent catalog。
- 把三卡或四卡 Right Rail 写成现行契约、把未实现模块写成已完成。
- 官方未改 seed 的 `.migrated` 备份、Ask/Plan/Edit 作为运行时 fallback、恢复 ask/plan/edit 运行通道或 custom manifest fallback、Run v2 双读、Mission generic `shell`。
- 禁止恢复 Embedding capability / Semantic lane / `settings.llm.embedding` / `EmbeddingCatalog` / `EmbeddingExecutionService`。

T19 逐项裁决（删除 / 保留理由 / 调用方）：

| 项 | 裁决 | 理由 / 调用方 | 测试/门禁 |
| --- | --- | --- | --- |
| `src/main/reports/ArtifactStore.ts` + `artifact_store.json` | **保留** | `output_register` / `SessionArtifactSource` 的 Outputs 索引，不是 Investigation。禁止混进 Artifacts 卡。 | `OutputRegistrationTool.test.ts`；`pnpm run check:right-rail` |
| `writeSessionPlanArtifact` 钉死 `artifacts/plan.md` | **改为计划门** | 同意前覆盖 `session://plans/plan.md`，同意后冻结 `plan-<ISO>-<hash8>.md`，下一周期再写同一活文件；禁止拒绝后新开对话。 | `sessionPlanArtifact.test.ts` |
| `src/shared/types/harness.ts` | **收敛保留** | 只留 Outputs `ArtifactKind` / `ArtifactRecord`。**不改名**。删除未用的旧 Debugger harness 类型。Investigation `EvidenceRecord` 仍以 `renderdocInvestigation.ts` 为准。禁止恢复固定 stage。 | `pnpm run check:legacy-residue`（断言该路径仍存在且无旧 harness 类型） |
| `RdcCliInvokerService` `tool_count` | **保留诊断、禁止 UI** | CLI 内部 invoker 诊断可用；Right Rail / 模型工具面不得展示 catalog summary。 | `pnpm run check:right-rail` |
| stage / `WorkflowStage` / `recommendedSpecialists` | **已删** | 见裁决 I；不得双读 v2。 | `pnpm run check:investigation-system`；Run v3 合同见裁决 I |
| agent-trace `phases`（understand/work/summarize） | **保留并对齐** | Work Process / Trace UI 展示相位，不是 Run `WorkflowStage`。重建时间线只发这三相位，不再发旧 `plan`/`execute` phase id。`PhaseKind` 里的 `plan`/`execute` 是 trace node 词汇，不是 Run stage。 | `pnpm run check:work-process` |
| Classic Session Panel / ArtifactViewer | **已不在 renderer 入口** | 禁止恢复。 | `pnpm run check:right-rail` |
| `Classic` / `legacy` / `deprecated` / `compat` 文案 | **按语义保留** | provider `deprecated`、Knowledge lifecycle `deprecated`、OpenAI-compatible 协议名为合法词，禁止借清理误删。 | `pnpm run check:legacy-residue`（精确上下文白名单） |
| `ErrorRecovery` 等 recoverable fallback | **保留** | Availability 分类，不是 legacy 双轨。 | `ErrorRecovery.test.ts`；`ConversationTurnDiagnostic.test.ts` |
| `MCPManager` name-segment fail-closed | **保留 fail-closed** | in-flight encode/decode 协议必需；`encode(decode(x)) !== x` → null；不是 compat 读路径。 | `MCPManager.test.ts`；`pnpm run check:legacy-residue` |
| `modes.ts` capability table | **已删除** | 只被测试使用且把 analyzer/optimizer 标未实现；保留 `assignDefaultCaptureRoles`。 | `modes.test.ts`；`pnpm run check:legacy-residue` |
| dead workspace write / intake / gate types | **已删除** | 死类型，不是现行合同。`AgentManifestWriteScope` 是 Settings 作用域，不是本项。 | `pnpm run check:legacy-residue`；`pnpm run check:shared-exports` |
| `AgentTimelineEntry.type` 收窄 | **已收窄** | 只保留实际发出的 `user` / `agent` / `system` / `tool_call`。 | `src/shared/types/agent.timeline.test.ts`；`pnpm run check:legacy-residue` |
| `coordinationMode` | **已改为 `turn_handoff`** | shared / main / renderer / 测试同步；中性命名，不是 stage 双轨。 | `src/shared/types/workflow.test.ts`；`pnpm run check:legacy-residue` |
| `check-investigation-system` phase 合同 | **已改写** | 现行 understand/work/summarize phase 合同；禁止再扫旧固定 Plan 相位表。 | `pnpm run check:investigation-system` |
| unread RDC runtime leak marker | **已删除写入** | 只写不读。改 runtimeLog 诊断 + 现有 `ProcessSupervisor unconfirmed_orphan`；`~/.rdc-agent` 不再有无读者文件。 | `RdcSessionService.test.ts`；`pnpm run check:legacy-residue` |
| `check:legacy-residue` 零命中 | **已落地** | 每项一条 forbidden pattern/path/导出/动态 import/mock 扫描；合法词用精确上下文白名单。已接入 `check:gates`。`check:acceptance-ledger` 已由 U04 接入 CI / `check:gates`。 | `pnpm run check:legacy-residue`；`pnpm run check:acceptance-ledger` |

### I. Run Schema v3

| | 裁决 |
| --- | --- |
| **当前态** | 唯一活跃 schema 为 `schemaVersion: '3'`（`src/main/sessions/runV3/`）。新记录无 `lastStage`、`runtime.workflow_stage`、`WorkflowStage` / `WorkflowPhase`、`stages.ts`、`recommendedSpecialists`。v0–v2 在 session-scoped `.run-v3-migration.lock` 内 archive-and-rewrite 到 `migration-backups/run-v3/<runId>/<sha256>.<ext>`；既有 `migration-backups/run-v2/` 保持原样。生命周期只由 `RunStatus` + turn transaction 驱动，不再从 finalize stage 自动完成。 |
| **目标态** | 唯一活跃 schema 为 `schemaVersion: '3'`。新记录禁止 `lastStage`、`runtime.workflow_stage`、`WorkflowStage` / `WorkflowPhase`、stage constants、stage event/IPC/update API、`recommendedSpecialists`。Canonical 替代：权限 = effective `profileId` + frozen allowlist；Mission 身份 = `run.kind + mission + profileId`；生命周期 = `RunStatus` + turn transaction；用户进度 = `TaskRegistry` / `taskProjection`；方法进度 = Investigation records / checkpoints；输出阶段 = canonical `outputPhase`。 |
| **迁移门禁** | v0–v2 在 session-scoped `.run-v3-migration.lock` 内 archive-and-rewrite。原 bytes 写入 `migration-backups/run-v3/<runId>/<sha256>.<ext>`，`writeUtf8AtomicFsync` + 写后 hash 校验；同 hash 幂等，冲突 fail-closed。archive 成功后才 temp+fsync+atomic replace canonical v3。既有 `run-v2` archive 保持原样，不迁移、不 GC。未知更高 schema 不 archive、不改写，直接 fail-closed。无法分类的历史 run 只能成为带迁移诊断的 `kind: conversation`，**绝不从旧 stage 推断 Mission**。旧标识只允许出现在隔离 migration reader、migration diagnostic/error code 和 raw historical fixture。archive 不进入 Run 枚举、IPC、UI 或 Right Rail。实现时不得对 v2/v3 双读。 |

### J. Mission Plan-Only Tool Surface

| | 裁决 |
| --- | --- |
| **当前态** | 三 Mission profile 已为严格 plan-only：token 展开剔除 `shell` / `code_interpreter` / `output_register`，四层 enforcement（profile 解析、冻结 EffectiveRuntimePlan、AgentPermissionPolicy hard deny、tool activation）已落地，Full access 不能绕过。`rdc_probe` 已实现（Settings `tooling.rdc-agentCli` 只读 closed allowlist；lease 仅当前 session；raw `.rdc` bytes 不进模型）。T18 知识导入 已证见下文已证组。产品级 Browser QA 全矩阵见 U05；U06 仅保留历史运行事实；Optimizer 真实实验结论已撤回，见 ledger 更正。 |
| **目标态** | Mission profiles（`debugger` / `analyzer` / `optimizer`）runtime allowlist **仅允许**下列工具。**General** 通过 Settings 配置的 CLI 与结构化 `shell.rdc-agent` 执行需要 lease 的 Live RDC 操作。 |
| **迁移门禁** | T00 定稿契约；T03 落地四层 enforcement；T06 落地 delegated lease 与 `rdc_probe` 执行。不得只靠 prompt 文案。Full access 不能绕过。 |

Mission profiles runtime allowlist **仅允许**：

- 信息只读：`read` / `search` / `web`（展开后的只读文件/搜索/网页工具，不含 write/edit）
- 用户询问：`ask_user`（askUser token）
- 任务进度：`task_create` / `task_update` / `task_get` / `task_list` / `task_stop`（`task` token 展开时 **必须剔除** `output_register`）
- 制品：`plan_artifact`（人机门，与 `ask_user` 同构停顿）、`investigation_read` / `investigation_write` / `investigation_list`
- 知识（只读 + 显式 Candidate）：`knowledge_browse` / `knowledge_search` / `knowledge_read` / `knowledge_compile` / `knowledge_candidate_create`（后者仅显式用户意图；不自动持久写）
- Memory 只读：`memory_search` / `memory_read`（禁止 `memory_write` / `memory_delete`）
- Skill 发现：`tool_search` / `skills` / `skill_read`
- Subagent：`subagent`（父 manifest `agents` 白名单；Mission 默认仅 `general`）
- RDC 只读面：`rdc_context`（读当前 session lease 状态）+ **`rdc_probe`（新 id）**

**`rdc_probe` 契约（T00 定稿，T03/T06 实现）**：

- tool id: `rdc_probe`
- 唯一执行路径：Settings `tooling.rdc-agentCli` 指定的原生 rdc executable。七个外层 action 经 `compileRdcProbe` 编译为真实命令，lease 开闭复用 capture lifecycle 和已有桌面 actions。应用 session ID 不作为 CLI replay ID；拥有者 daemon context 必须显式绑定。
- 输入 schema（语义，实现时 Zod）：`{ action: 'enumerate' | 'doctor' | 'version' | 'probe' | 'lease_open' | 'lease_close' | 'preview_status'; capturePath?: string; contextId?: string; args?: Record<string, string> }`。`probe` 只允许只读查询类 action name（由共享闭集逐操作校验），禁止 shader replace / replay mutate / write capture / 任意 argv。
- 输出：结构化 JSON（exitCode、stdout 截断摘要、artifact ref 若超阈值、world-state 戳）。raw `.rdc` bytes 永不进入模型上下文或 Provider。
- lease open/close 只创建/释放 **当前 session** 的 per-session lease；不执行 mutate。
- Mission 调用 `rdc_probe` 不得获得 generic shell。General 需要 Live RDC mutate（shader replace、replay variant、timing experiment apply）时走 `shell` + Settings action，且必须持有 exclusive lease。

**明确禁止（四层 enforcement 目标，T03 实现）**：

`shell`、`code_interpreter`、`write` / `edit` / `git` / `file-manage`、`output_register`、`memory_write` / `memory_delete`、session create/delete/rewrite/branch、model/settings mutation、generic filesystem、MCP tools、project/output/external mutation、任意未在共享只读查询闭集中的 RDC action。

Enforcement 必须同时发生在：(1) profile allowlist 解析（token 展开后过滤）；(2) 冻结 EffectiveRuntimePlan executor；(3) AgentPermissionPolicy hard deny；(4) tool activation。不能只靠 prompt 文案。Full access 不能绕过。

### K. Hook Trust Fingerprint

| | 裁决 |
| --- | --- |
| **当前态** | Hook trust fingerprint 已覆盖 parsed definition + resolved 脚本/参数文件 bytes + canonical realpath + scope/provenance + PATH executable identity（`hook-trust.json` schemaVersion 2）。旧 YAML-only 记录首次加载失效并要求 retrust，不静默沿用。user/project 必须显式 trust；builtin 默认信任。12 canonical events 走单一 `HookEngine` 路径。产品级 Browser QA 全矩阵见 U05 / ledger。 |
| **目标态** | Hook trust fingerprint = parsed definition + 所有 resolved 脚本/参数文件 bytes + canonical realpath + scope/provenance + PATH 解析后的 executable identity。任一变化 → `needsRetrust`。builtin 默认信任且内容变化必须随仓库发布；user/project 必须显式 trust。12 canonical events 保持单一 HookEngine 路径。 |
| **迁移门禁** | 旧仅-YAML-hash trust 在首次加载时失效并要求 retrust（不静默沿用）。不得保留 YAML-only 与全指纹双轨。 |

### L. Mission Completion Contract

| | 裁决 |
| --- | --- |
| **当前态** | 普通对话回复只结束消息，不自动完成 Investigation 或 Task；显式 `turn_complete(completed)` 的 Mission 完成门禁已落地（checkpoint + ready report + 完整章节 `conclusion` / `evidence` / `verification` / `limitations` / `status` / `links` + canonical `outputPhase=final_answer` 引用该 report）。Partial / Inconclusive / Blocked 不得伪装 completed。不能只靠 hook、模型文本或 `output_register`。普通 General 不受此合同约束，也不得宣告调查 `completed`。回评估由用户切回 Mission 后的新回合完成。T18 负路径 / Blocked 收口已证见下文已证组。U06 仅保留历史运行事实；Optimizer 真实实验结论已撤回，见 ledger 更正；产品级 Browser QA 全矩阵见 U05 / ledger。 |
| **目标态** | Debugger / Analyzer / Optimizer 正常 `completed` 必须同时具备：可解引用 `MissionCheckpoint`；`kind=report` 且 `status=ready`（sourceRefs + contentHash 三条件）；完整章节 `conclusion` / `evidence` / `verification` / `limitations` / `status` / `links`；canonical `outputPhase=final_answer` 且正文引用该 report artifactId+hash。Partial / Inconclusive / Blocked 不得伪装 completed。不能只靠 hook、模型文本或 `output_register`。General 不受此合同约束。 |
| **迁移门禁** | 实现必须把完成门禁放进 turn / Mission 收口，不得只加 hook 或提示词。 |

## Right Rail Authority

Right Rail 有两个按选择对象区分的表面。选中 Project 时**只**渲染项目级 `Import .rdc` 输入面与已导入 capture 列表，永不读取 session runtime。

选中 Session 时渲染五张不可折叠圆角卡 `Progress / Artifacts / Outputs / Context / Capture`。Artifacts 只投影 main-owned Investigation Artifacts；Outputs 仍只接受 `output_register`；Capture 保留 scoped `.rdc` 选择、Replay Device、open / close / 内嵌帧回放 / Agent 足迹 / refresh 与紧凑诊断。

main-owned `RightRailProjectionService` 为显式 `{ projectId, sessionId }` 组装 `RightPanelViewModel`；renderer 只消费投影，不从 action events、全局 capture、工作目录扫描或 tool catalog 重建 Progress / Artifacts / Outputs / Context / Capture。Progress 是单一规范列表（`RightPanelViewModel.progress: ProgressTask[]`），创建序，已完成项就地保留，并与 transcript `taskProjection` 同序同态。Context 只含被冻结 Prompt 段或成功 tool result 证明的具体任务资源。Capture 在 session 中始终可见：诚实空态或 owner-session 操作面。Outputs 拒绝 inputs 与 plan。Investigation Artifacts 不得混进 Outputs。卡外壳在 empty / populated 之间不变；空内容用安静线框插图，有内容只增高本卡并在兄弟行间使用内部 hairline。Dock 在紧凑桌面宽度仍可用，仅在 `RIGHT_RAIL_DRAWER_BREAKPOINT`（920px）及以下或无法保住最小工作面时变为共享 overlay drawer。静态门禁：`pnpm run check:right-rail`，只认五卡。

## T18 现场取证（2026-09-03）

每行对应 [`docs/product/acceptance-ledger.md`](docs/product/acceptance-ledger.md) 行 id。事实保留原证；未证与硬件阻塞不得标成已验收。产品级 Browser QA 全矩阵见 U05；U06 仅保留历史运行事实；Optimizer 真实实验结论已撤回，见 ledger 更正。

### 已证

| Ledger | 项 | 状态 | 证据 |
| --- | --- | --- | --- |
| `T18-colddata-draft` | 知识导入 → session Draft | 已证 | `knowledge:import` 两份桌面案例；`candidateCreated: false`；`sourceStatus: fixed`；`verified: false`；再导入 `conflict` |
| `T18-colddata-source` | 知识导入 源不变 | 已证 | `BugFull案例01.txt` SHA256 `b3885f07…c381d0`；`BugFull案例02.txt` `bfa12c54…7e35e5`；与 Draft `sourceHash` 一致 |
| `T18-colddata-userspace` | user-space 持久化 | 已证 | `~/.rdc-agent/knowledge/cases/AIRD-20260207-000{1,2}.md`；index `cardCount: 2`；Center **User space 2**；中文标题完整 |
| `T18-chinese-capture-open` | 中文 1.57GB capture | open+preview 已证 | `眼睛泪腺白点.rdc` SHA256 `0A79926A92E7E659989BEFC2322DC93B65782252FC5BE2DE33496142735A4094`；size `1647684424`；`openProjectInput` `status: open`；`openHumanPreview` `success`；hash 2026-09-04 复测仍不变 |
| `T18-t15-debugger-neg` | T15 Debugger 负路径 | 已证 | 无 capture：`sess_df6be27d58a5` → `MISSION_COMPLETION_DENIED`（`debugger cannot complete without a dereferenceable MissionCheckpoint`），未伪装 completed。Settings RDC CLI 已配置；未配置 fail-closed 单测在 `adafa804`。WhiteHair 正路径被 `LOCAL_REPLAY_UNSUPPORTED` 挡住（正路径见硬件阻塞组 `T18-whitehair-open`） |
| `T18-t16-analyzer-blocked` | T16 Analyzer 闭环 | Blocked 诚实收口 | `sess_5be2b0c52a58` / `proj_a99a24c68de3`；`rdc_probe version` ok（schema 3.0.0）；`preview_status` exit 2；`investigation_write` 写出 world/evidence/claim/checkpoint + ready report `invart-55a27b669134-1788459010567`（`sha256:3fc09696feae39145fd4c94c66c9260dda460f1da610e0d618789328aba4c5e3`）；source claim `cl_t16` 仍为 draft 未被 supersede；`reportContract.status=Blocked` → turn `MISSION_COMPLETION_DENIED`（`Blocked cannot complete`），未伪装 completed。伴随修复：`ToolValidator` 省略 `properties` 的 object 作 opaque bag；`report` 不再占用 cited `claimId`（`a37c107e`） |
| `T18-t17-optimizer-blocked` | T17 Optimizer 闭环 | Blocked 诚实收口 | `sess_a73c57d0d2a5` / `proj_a99a24c68de3`；plan-only；`rdc_probe version` ok；`preview_status` exit 2；未写 Experiment / 未 mutate 工程；ready world `invart-9c0432fc5f8d-1788459329316`、claim `cl_t17` `invart-654177b47a50-1788459452297`（仍 ready，未被 report supersede）、checkpoint `cp_t17` `invart-85907a5d7764-1788459462807`、ready report `invart-71244190ba45-1788459648111`（`sha256:335d77de70a9a196f150330f7ae703366dd240b6723c9714e57eb6bc4ab10bbd`，`reportContract.status=Blocked`）→ `MISSION_COMPLETION_DENIED`（`Blocked cannot complete`） |
| `T18-semantic` | Semantic / 真实 OpenAI embed | 已关闭 | 真实 OpenAI embed **不再补跑**（U02 已删除 Embedding capability / Semantic lane）。 |
| `U06-t15-completed` | T15 Debugger 正路径 | 已证 | Android adb `e38b8019` / `android-e38b8019` 打开 WhiteHair；`sess_257be2c23d01` `run_2dad9f141f927f53` `completed`；checkpoint `cp-whitehair-eid167`；ready report `invart-173a94986fc4-1788550214355`（`sha256:3316c40ecc39baeed4a9c591fbcd539254f5cb4f908ec6317d4261b39b62cce5`，`reportContract.status=complete`）；final_answer 引用该报告。Local WhiteHair 仍见硬件阻塞组。 |
| `U06-t16-completed` | T16 Analyzer 正路径 | 已证 | `sess_cff62330e3a7` `run_0f8e5559dec166c5` `completed`；三层 claim `observed_fact` / `derived_structure` / `semantic_inference`；ready report `invart-e924efb74e67-1788553110003`（`sha256:a38491c36d4079f987b1ec80e3df64a7dd715096f70203998d61cc8a530d8ce9`，`complete`）；`cancelActiveTurn` 后 index 无迟到写入。 |
| `U06-t17-completed` | T17 Optimizer 历史完成记录 | 已撤回真实实验结论 | `sess_db9dfe15578b` `run_85f6c28295a4e8b7` `completed`；Experiment `exp-opt-lacrimal-aba` `rolled_back` 且 rollback 三条件成立；Mission 侧 shell/write 被拒；工程目录 manifest 前后一致；ready report `invart-report-opt-lacrimal-ready`（`sha256:11792293953c9ba73da74668a29baebd61f91596edab28f7499113bed1f426f6`，`complete`）。 |

### 未证

无剩余未证项。`T18-semantic` 已关闭，见上表。硬件阻塞见下一组。

### 硬件阻塞

| Ledger | 项 | 状态 | 证据 |
| --- | --- | --- | --- |
| `T18-whitehair-open` | WhiteHair open | 硬件 BLOCKED | `sess_17b59bc0131c` `openProjectInput(input_whitehair)` → `LOCAL_REPLAY_UNSUPPORTED`（Adreno 650 `VK_EXT_fragment_density_map` vs RTX 5090）；SHA256 仍为 `03DF08D14E6D5819E5173209D9AC1218C2F740010104EC911A7873E97A258D42`；size `168591424`。正路径 Local replay 本机不可做，不空等。T15 Debugger 正路径闭环改由 U06 在 Android adb 设备上补跑，本行不得标 verified。 |


## 通用 Harness 与声明续跑（2026-09-15）

General 为默认通用工作身份。核心正文只负责可信上下文、授权、持续执行、Skill 发现与收口；领域名称可留在能力目录。renderdoc-investigation 按调查目标选择 Mission，普通术语问答不强制路由。Mission 策略采用 renderdoc-execution 的六块 Markdown 模板，按规模填写；Knowledge 相似性仅是检查线索。

`handoffs` 只驱动建议行和计划门按钮。人点后主进程 `applyDeclaredHandoff` 校验声明属于当前（或刚批准的）profile，写入/确认 session execution offer，触发 `before-handoff` / `after-handoff`，并 persist `session.agentId`。`send: true` 只表示点完后预填并自动发送。不存在 `agent_handoff` 工具、durable `prepared → committed → consumed` 状态机、强制 return 或自动回 Mission。

Plan 经 session artifact plans 类别版本化：同意前覆盖活文件，同意后冻结副本，历史文件不迁移或删除。批准写入 offer（source / target / plan.uri+hash / 声明 requiredSkillIds）。prepareTurn 仅当本回合 `agentId === targetAgentId` 且批准计划与 offer 同 hash 时预载 Skill；权限仍走冻结 catalog 与交集。通用 turn 仅调用 TurnCompletionValidator。Big Loop 由 General 终答写缺口、用户切回 Mission、新计划、再批准、再点 Execute 组成；runtime 不按身份 / depth / 正文开下一轮。打开会话时若仍有 `handoff-state.json`，只 unlink，不 parse、不迁移。

普通 Capsule 省略领域扩展且没有 RDC Lease prompt 段；仅 RDC 模块接受 domainExtensions.rdc-agent.requiresLease=true 并注入租约上下文。缺省无 RDC，授权子代理串行且 finally 撤销；旧顶层字段拒绝，不保留双轨。


### Task 预算与取消所有权（2026-09-10）

通用 harness 的逻辑 Task、执行实例与 root budget 统一持久化在 TaskStore。直接执行、同步/后台子执行共享根预算；Capsule 只收窄 child-local 账本，重试恢复原执行已消费量和原 root 关联。预算预留持久化先于工具效果，父回复结束不重置账本。并发首次绑定同一 root 只合并一次；已绑定 root A 的同一 live ledger 请求 root B 时显式拒绝，保持原账本与观察者归属，不建立多根合并或静默换绑路径。

任务取消终态须在实际 producer 与所属进程退出后保存；同 turn 取消请求不 self-join。声明续跑切 Agent 后的新回合是独立 turn，不继承未完成 handoff 取消令牌。字段与调用合同以 [runtime-kernel](docs/contracts/runtime-kernel.md) 的 Task 执行章节为准，领域调查策略仍由实际加载的指令决定。

## Session Capture 内嵌回放裁决（2026-09-13）

- 项目 RDC 列表为空时保持原 Capture 空态外观、文案与交互；不挂载新控件、历史或画面。非空时右下角五卡结构不变，Capture 内提供文件、设备、打开/关闭、帧回放和 Agent 足迹。
- 完整文件扫描确认的输入列表独立提交和广播；最后一个 RDC 消失后，即使回放释放或足迹清理失败，也必须保持真实空态。清理待办单独持久化，不能用旧输入列表保存恢复状态；扫描不完整或项目不可访问时不得推断文件缺失。
- `RdcSessionService` 按 project/session 管理独立 `RdcSessionRuntime`。native daemon context 由 main 分配，与 inputId 不等价；配置的 lifecycle action 必须使用 `{{contextId}}`，返回身份不一致拒绝绑定。关闭失败、半开失败和未确认子进程保留 owning context，不能清空其他 session lease。
- Android 设备由单个 session 独占，不抢占。Agent preparing 至 active turn 收口期间禁止人工改变回放；delegated child 未 join 与 native exit 未确认继续锁定。人工和 Agent 原生命令经过同一 context 队列。
- Open 加载可证的最终呈现颜色输出；事件滑条实际 apply。requested/applied/image EID、generation、revision 分离，迟到画面不得重标为新事件。应用 preview 是 main 校验后交付的内嵌图片；退役独立 human-preview API 和 Settings action。独立 Tools CLI 的窗口输出仍是有效外部功能。
- 足迹位于 `<project>/.rdc-agent/replay/<sessionId>/<captureSha256>`，内容 SHA-256 与 lease 身份摘要分离。图片最大边 960 px，PNG 保持 alpha；session 256 MiB、project 2 GiB，到限停止保存、不淘汰旧证据。关闭保留历史；重启只恢复选择和历史，不自动打开或占设备。
- native Remote 当前返回 `unsupported`，不能声称 Android 设备显示已同步。本地 native observation 通过不代表 Android 屏幕呈现通过；真实验收依 acceptance ledger 分项记录。

Android 设备选择不发起脱离 owning context 的连接。连接统一发生在 Capture 会话生命周期中；已有 helper 的借用与自有 helper 的清理由 Tools 实际归属决定，应用不得按设备类型关闭用户服务。确定性 Mission 编排验收与真实模型效果验收分别记录。
