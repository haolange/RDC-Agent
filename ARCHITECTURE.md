# RDC-Agent 工程架构与产品边界

`ARCHITECTURE.md` 是本仓库**产品边界、架构原则、权威地图与核心不变量**的裁决文件。代码与本文冲突时以代码为准并修正本文；本文与其他文档（`README.md`、`AGENTS.md`、`docs/**`）冲突时以本文为准并同步修正其他文档。详细契约、产品规格与 UI 规范分拆在 `docs/`，本文只保留裁决层与索引。验证命令表由 [`AGENTS.md`](AGENTS.md) §5 维护，本文只列门禁名称；验收记录见 [`docs/product/acceptance-ledger.md`](docs/product/acceptance-ledger.md)。

## Product Boundary

RDC-Agent 是通用 agent workbench，并一等公民支持 RenderDoc `.rdc`。它是日常 agent 工作台，完成阅读、规划、编辑、搜索、工具调用、handoff、memory 与 subagent 编排，同时保留 capture 打开、replay 上下文、RDC 原生操作、诊断与 RenderDoc 调查等垂直能力。

**发布面是 Windows-only。** `electron-builder.json` 只保留 `win`；POSIX launcher wrapper（`.sh`）仅供 Ubuntu CI 的 node 面准备。Windows release 通道（`RDC_AGENT_RELEASE_CHANNEL=release` 或 git tag）必须提供 `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`（或 `CSC_*` 别名）；唯一例外是显式 `RDC_AGENT_RELEASE_CHANNEL=prerelease`、package 带预发布后缀且 tag（如有）与该版本完全一致，只能发布为明确披露未签名的 GitHub prerelease。本地 `pnpm run pack` 不签名。SBOM 由完整 `pnpm-lock.yaml` 传递依赖图生成 CycloneDX，并记录 git SHA 与 lockfile digest。发行候选同时提供 Windows zip 与 NSIS。

**不做** image/video 生成 runtime、media provider 目录面或 `MediaRuntimeService` 类骨架；discovery 对非 agent modality（含 image/video output）fail-closed 剔除。用户附件 vision-input（读图）属 agent chat 能力，与生成 media 无关。

产品不是固定模式向导。默认顶层入口为 `general` / `debugger` / `analyzer` / `optimizer`；另有 `generator` / `verifier` / `knowledge-scout` / `report-writer` / `shader-analyst` / `pass-analyst` / `resource-analyst` / `pixel-analyst` 八个默认内部 builtin。全部经同一 `builtin < user < project` 整资源解析与 Agents 设置管理；内部 profile 默认不出现在用户入口。历史 ask/plan/edit 及 S0 specialist id 一律拒绝。模型与推理档位属于目标 Agent 配置，方法由默认 Skill 装载，二者都不扩大权限。Session rail 为 `Progress / Artifacts / Outputs / Context / Capture`。`handoffs` 只驱动建议行和计划门，用户批准并点声明后由 General 就地执行与交付，战略改变由用户切回 Mission。Knowledge 使用 markdown-first 六 lane。

操作知识与执行权限分开：三条 Mission 可按需通过 `skills` / `skill_read` 读取共享 `rdc-tool-shell` 及各自一本专业手册和引用，用于规划参数、证据与调用成本；其它专业手册不可见。正文不自动预载，也不改变 profile 的工具集或在途权限。Mission 为 plan-only；General 经批准计划、声明交接及 requiredSkillIds 的真实预载后，按冻结 catalog、审批和 owning lease 执行。

唯一运行时路径是 agent loop：解析 profile / model route / policy / tools → 调用 LLM → 执行已批准工具 → 回灌结果 → 产出 final answer。Renderer 不伪造推理阶段；隐藏 CoT 永不作为 UI 内容展示或持久化。

Agent loop 不把“耗尽 turns”或“重复相同工具轮次”当作完成。`LoopProgressGuard` 对工具名、规范化参数、结果语义与 runtime revision 生成稳定指纹；连续第二轮无进展只注入一次不落盘纠偏指令，第三轮仍相同以 `AGENT_NO_PROGRESS` 终止。仍需 continuation 却达到 `maxTurns` 时以 `AGENT_MAX_TURNS_EXCEEDED` 终止；`maxTurns` 是防失控的安全停止，不是计划可分配的阶段预算。两者分别投影 `CONVERSATION_AGENT_LOOP_STALLED` / `CONVERSATION_AGENT_TURN_LIMIT_EXCEEDED`，不归类为 Provider 请求失败。

### 首次使用与本机安装

上手指南是四步图文操作教程，首次 bootstrap 后展示，标题栏问号可重开。每页解释操作入口、动作与完成预期；本地教学图与 HTML 双语标注分离，标明示意而非当前配置。桌面左文右图、窄屏上图下文，沿用 TaskDialog 与固定底部导航。关闭/完成只确认已阅读，标记写 Electron 应用状态目录；不创建 Project、不保存 Provider、不执行模型请求。Builtin 直接读取随应用打包的文件，不写 user seed。

Settings 的 RDC 安装入口为检测安装、选择目录、验证并应用。主进程从根目录派生同安装捆绑 Python 与 CLI，验证 catalog 后由 Settings 边界保存。检测只读已配置位置和 Tools 默认 `%LOCALAPPDATA%/Programs/rdc-tool`；用户确认前不执行候选。根目录不是第二份持久配置。失败保留原配置；未配置 RDC 不阻塞 General。

## Architecture Principles

复杂度服务于当前能力或明确的不变量。用职责、所有权、生命周期与清晰接口限制故障范围；每个检查与恢复机制都有独立职责。无法满足合同的操作在所属边界失败，并把真实原因交给调用方，由调用方决定放弃、重试或修正输入。局部失败不无依据地扩大影响范围，隔离失败仍保护数据、释放自有资源，安全与完整性不变量不放宽。失败分类见 `docs/contracts/failure-model.md`。

1. **单一真相**：Session / Conversation / branch / journal 是会话历史权威；Agent slot 是执行配置与缓存，不是私有历史。
2. **冻结执行**：`EffectiveRuntimePlan`（`schemaVersion: 3`，含 `planId` / fingerprint 与冻结工具/策略约束面）在 `prepareTurn` 冻结；Prompt 与 Executor 共用冻结约束；主进程 mode/revision 在工具准入和每次 Provider 请求前采样，不进入冻结权限约束。
3. **主进程权威**：权限、secret、MCP trust、Shell、RDC CLI、IPC 校验均在 `src/main`；preload / renderer / Browser Bridge 只暴露受控面。
4. **Scope 固定**：用户资源 `~/.rdc-agent`，项目资源 `<project-root>/.rdc-agent`（用户点保存的计划在 `plans/<sessionId>/`）；无配置 workspace root、无旧目录 fallback、无静默迁移。
5. **Provider 事实分层**：Manifest 是**基线真值**（baseline truth），Discovery 是**候选验证**（candidate validation），用户覆盖（`models.json`）是**显式覆盖，自带 provenance**（explicit override with provenance），三者合并为 EffectiveCatalog。模型/协议/控件基线事实只在 `src/shared/provider-catalog/manifests` 的严格 JSON；TS 只实现 Schema、compiler、Registry、Resolver、Planner、adapter、auth、discovery 与 user-override。用户覆盖不得触及 route.protocol、authSchemaId、adapterId、compatibilityGroup、carrier 等安全/延续性字段。
   `catalogRevision` 只冻结 Effective Catalog 的可执行/可选择语义；刷新仅更新 provenance 时间戳时 revision 稳定，route、control、availability、quota 等有效语义变化时才更新。
6. **可取消与可回收**：Turn 经 `TurnCoordinator`（Session ownership：Active → Aborting → Orphaned → Settled；Orphaned 时 `beginTurn` fail-closed `TURN_ORPHANED`；`abortAndJoin` 等 stream terminal **与** producerCompletion）。子进程经 `ProcessSupervisor`；应用退出经 `ShutdownCoordinator`（`release_owned_runtimes` 先于 `terminate_processes`）；迟到 event 按 generation 丢弃。无 durable session 的 turn/slot 使用 ephemeral scope id（禁止 `__anon__` / `__no_session__`）。Conversation Stop 相位语义：`preparing` 干净撤销；`committing`/`running` 单调落停。Renderer 对 monotonic-stopped turn/request 丢弃迟到 `draft|streaming` patch。会话工作块与工具的取消使用 cancelled，未执行 skipped，真实失败 error，不伪造用户拒绝；main 与乐观停止共用纯结算。当前计划携带 owning Turn，修订与决定核对真实归属；包含审阅交互的 result 不再重复提供 handoff，计划执行动作仅位于待审 Composer。ProcessSupervisor 超时未观察到 close 时标记 `unconfirmed_orphan` 并保留 registry。归属 RDC daemon 必须 clear+stop 且有进程回执，失败如实保留。
7. **失败有分类**：安全类 fail-closed；完整性 degrade-safe；可用性 recoverable。分类权威见 `docs/contracts/failure-model.md`。
8. **无 legacy 双轨**：新结构替代旧结构时直接收敛；不保留兼容 shim。
9. **对话模型**：Composer 底栏与 `/model` 选择的是**当前对话模型**，不写回 `.agent.md`。Settings 里的 Agent provider/model 只在用户还没点选时作为种子。未 override 是显式可选状态（菜单「按 Agent 配置」与 `/model default`）：有 session 时清除写入 `SessionRecord.modelOverride = null`，无 session 时清 Composer 草稿。Agent route 当前不可执行时禁止清除。`/model` 与底栏共用 EffectiveCatalog + `isAgentToolExecutableModel` 可选集；裸 `default` 先于 `provider:model` 解析，真名叫 `default` 的模型用 canonical `provider:model` 逃生。有 session 时写入 `SessionRecord.modelOverride`；无 session 时只记 Composer 草稿，首次发送随 `configurationCommit` 进入 `resolveAgentRoutePreflight` 并在 session 落地后粘性保存。切 Agent **不清**模型。父 session 模型 **不传** sub agent。Agent 可执行模型必须具备 source-backed `toolCalling.supported` 与已实现 structured-tool adapter；`unknown`/`unsupported` 不是选择项，已持久 override 或 Agent route 指向它们时 fail-closed 并给出同 provider 已验证候选项，不静默回退。Settings catalog 保留完整可审计记录。非法 model fail-closed，不回退 Agent 种子。
10. **Agent Shell**：命令工具 id 是 `shell`。解释器由 `ShellResolver` 解析（Settings `tooling.shell.executable` 本机覆盖 → 真实 pwsh 7 → Windows PowerShell 5.1；POSIX 优先 `$SHELL`（basename ∈ zsh/bash/sh/dash）→ `/bin/zsh` → `/bin/bash` → `/bin/sh`）。fish/csh/nu 等 fail-closed。全部失败抛 `SHELL_UNAVAILABLE`，不静默降级到 `cmd.exe`。POSIX 非交互走 login `-lc`；Windows 5.1 不改 `[Console]::OutputEncoding`，改用独立 UTF-8 writer，并显式 `$PSNativeCommandUseErrorActionPreference = $false`。每次调用 spawn 新进程，只用 GUID begin/trailer 回读 cwd；只持久化文件系统且位于 project root 内的 cwd 到 session `shell-state.json`，不存 env。旧 token `bash` 进入 `REJECTED_TOOL_TOKENS`，无展示别名、无静默映射。

### Provider 连接与选择响应

显式 Provider 能力探测经主进程冻结 RequestPlan/凭据并使用 PromptPlan；批量任务只在内存中按账号与配置身份串行运行，可取消并等待请求释放。Fast 按实际 binding 的服务端证据判定，短请求不能独自证明隐式 Max 扩窗；窗口、输入预算、输出与压缩字段分别计算。证据、缓存与 UI 契约见 Provider 架构文档。

计划授权区与 Composer 共用会话模型覆盖和回合参数。进入计划审批不切换到执行目标 Agent 的默认模型；无覆盖时继续使用当前对话的有效模型，批准前将继承模型与 Effort、Fast、Max 经既有接口一并保存到同一 SessionRecord，使交接后的新请求保持一致。保存中或失败时不能批准计划，授权交接等待最新保存并核对当前选择的模型可执行性。相同模型的 Agent 切换、目录刷新和控件重挂不重置参数；用户换模型时才按新能力合法化。prepare/commit 后禁用的 Composer 显示主进程确认的 route/controls，准备中保留所选模型与参数并以阶段提示标明待确认；确认后显示冻结请求事实。停用、断连或模型失效时保留配置引用，选择入口显示不可用并阻止新请求，不自动清除覆盖或切换路由；历史和在途请求按冻结快照显示。

普通工具声明及流式参数保留在审计记录，实际开始后才进入主执行轨道；审批、用户输入与执行前失败保留独立可见入口。executionStartedAt 由真实执行事件写入，历史缺失不补造耗时；蓝点仅表示真实 running。连续工具组全部终止后才按既有阈值聚合，子项身份与用户披露状态保持。每张 Task 更新卡初次出现默认展开，手动折叠不因后续活动重置，历史快照不被最新状态覆盖。

Grok 订阅只有系统默认浏览器 PKCE 自动回调入口；独立 xAI API Key 面保留，目录与计费不混用。Renderer 以共享内存快照投影 main EffectiveCatalog，按 provider/account/protocol 去重、失效和隔离迟到结果；菜单打开不等待全量目录加载。冗余技术信息通过所属详情按需披露。细节见 Provider 架构与设计系统。

系统默认浏览器打开请求完成后即进入等待授权，不等待网页加载；打开失败、取消与迟到结果按同一 flow 生命周期处理。浏览器标签页不归应用所有，取消只释放当前授权流程与回调。账号与套餐分开：认证方式不充当套餐名，缺失的套餐或额度保持未知。

## Authority Map

| 主题 | 权威位置 |
| --- | --- |
| 产品边界与本文件不变量 | 本文件 |
| 当前裁决（Profile、Right Rail、Knowledge 六 lane、Handoff、Investigation、并发、Run schema v3、Mission plan-only、Hook trust、Mission 完成合同） | 本文件「当前裁决」A–L |
| 验收记录（真实运行证据） | [`docs/product/acceptance-ledger.md`](docs/product/acceptance-ledger.md) |
| Runtime / Prompt / Provider / Tool / Session 契约 | [`docs/contracts/runtime-kernel.md`](docs/contracts/runtime-kernel.md) |
| Session Projection（active UI / 后台 cache / Composer 恢复） | [`docs/contracts/session-projection.md`](docs/contracts/session-projection.md) |
| Session `modelOverride`（所有权 / 冻结时机 / 不传子 agent） | 本文件 Architecture Principles §9；实现：`SessionRecord` + `resolveAgentRoutePreflight` |
| 权限、Bridge、Secret、MCP trust、Sandbox、CSP、IPC | [`docs/contracts/permissions.md`](docs/contracts/permissions.md) |
| Fail-closed 三分类与标注点 | [`docs/contracts/failure-model.md`](docs/contracts/failure-model.md) |
| Orchestrator façade 行数 / 职责外提 | 本文件核心 Invariant + `pnpm run check:orchestrator-facade` |
| Profiles / Skills / Hooks / Memory / RDC 产品规格 | [`docs/product/`](docs/product/) |
| RenderDoc 领域目标权威 | [`docs/product/RenderDoc Agent 完整设计书.md`](<docs/product/RenderDoc Agent 完整设计书.md>)（第 0 章为已定裁决）；工程合同冲突以本文件为准 |
| RDC 操作契约、lease、回放身份、Android 回执 | [`docs/architecture/rdc-runtime.md`](docs/architecture/rdc-runtime.md) |
| UI/UX 原则 | [`DESIGN.md`](DESIGN.md) |
| Workbench / Transcript / Composer | [`docs/ui/workbench-and-transcript.md`](docs/ui/workbench-and-transcript.md) |
| Design System（Token / 按钮 / 颜色 / 组件） | [`docs/ui/design-system.md`](docs/ui/design-system.md) |
| Work Process UI 验收 checklist | [`docs/ui/work-process-checklist.md`](docs/ui/work-process-checklist.md) |
| Appearance UI 验收 checklist | [`docs/ui/appearance-checklist.md`](docs/ui/appearance-checklist.md) |
| 模块地图与数据流 | [`docs/architecture/`](docs/architecture/) |
| 工作流与垂直调查执行计划 | [`docs/workflows/`](docs/workflows/) |
| Agent 修改纪律与验证命令 | [`AGENTS.md`](AGENTS.md) |

文档描述稳定契约，不回写运行时代码规则。

## 核心 Invariant

- **资源优先级**：`builtin < user < project`；整资源替换；policy 只收紧（deny 并集、审批强度只升、数值上限只降）。执行时 `built-in hard deny > user/project policy floor > Full access > tool metadata`；预算值必须是非负整数，`0` 表示禁止对应执行并 fail-closed，即使 Full access 也不能绕过 policy floor。Decision lattice 为 `allow < auto_review < ask_user < deny`；`approvalFloorByTool: user` 无条件 `ask_user`，不被 Permission Mode（含 Auto-review）降级。
- **Skill 工具面**：`allowedTools = ∩(skill_i) ∩ runtimeAllowlist`（空声明不收窄）；skill 只能收窄、永不扩展 profile 工具集；元工具豁免见 runtime 契约。
- **Deferred tools**：未激活 deferred → `TOOL_NOT_ACTIVATED`；`tool_search` 可激活。冻结有效工具集已允许时，计划门与 Tasks 可在 `prepareTurn` 预激活；`completion-contract: investigation-report` 的回合预激活调查记录工具，交接按声明的 `requiredToolIds` 预激活，不按 Agent 身份判断。预激活不扩展天花板、Skill 或 Policy 权限。
- **Tasks 能力真值**：Prompt 只描述 route 最终实际注入的工具。只读 route 仅可读 `task_list` / `task_get`；可写 route 仅在其冻结工具集确实包含 mutation 工具时才宣称可写。text-only route 不列出、不模仿也不反复搜索 Tasks 工具。可写时 `task_create` 一次批量建全表；开工前仅一条 `in_progress`；完成后立即 `completed` 再开下一条；`blocked` 必须带 `statusReason`；单步或琐碎工作不建任务。
- **Tool search 无匹配**：返回 `NO_MATCH_IN_EFFECTIVE_TOOL_SET`、`authoritative: true` 与有效工具集 fingerprint；fingerprint 未变化时不重复同一搜索。
- **Capability unknown**：`toolCalling.state === unknown` → text-only，不进入 Agent/Composer 可执行集合；仅 `supported` 且具备已实现 structured-tool adapter 才 `native-structured`。`unsupported` 保持明确拒绝诊断，不复用到 unknown。
- **输出通道**：`ProviderOutputRef` 一经声明永久归属 `thinking` | `text` | `tool_call` 之一；ref 承载 provider 侧 block 身份，已关闭的 block 不复用，多 part / 多 item 映射到不同 ref；普通 assistant text 永不合成 thinking。输出项的 provider phase 独立保留并在同源 Responses 历史中回放；未确认阶段的文本以中性状态原位流式呈现，只有正常结束确认的 `final_answer` 进入 canonical 正文。
- **Secret**：`safeStorage` 不可用则 fail-closed；secret 不进入 renderer / IPC 明文 / Trace / RequestPlan。
- **Browser Bridge (debug-only)**: only `RDC_AGENT_BROWSER_QA=1` (launcher browser/browser-dev) starts it. The authoritative entry is the one-time `/qa?qaBootstrap=...` URL printed by the launcher; successful bootstrap mints an HttpOnly `SameSite=Strict` cookie (with `Secure` for HTTPS) and redirects to clean `/app` on the **same bridge origin**. In `browser-dev`, Vite is reverse-proxied through the bridge (including HMR WebSocket); the browser never opens the Vite port and never carries bridge auth or a challenge in a URL query. Cookie-authenticated `/invoke`, `/events`, and `/api/*` require `Origin` equal to the bridge origin. Dev proxy strips `cookie` / `authorization` / `proxy-authorization` / `x-rdc-*` before forwarding to Vite. Programmatic clients may use an explicit Bearer header. Channel capability is a closed `Record<RendererInvokeChannel, BridgeChannelCapability>` in `src/shared/renderer-api/channelCapabilities.ts`; TypeScript forces every new channel to be classified; unknown channels fail closed. `high-impact` additionally requires `RDC_AGENT_BROWSER_QA_FULL_ACCESS=1`; `desktop-only` is always denied. Browser and Desktop share the single `src/shared/renderer-api` ElectronAPI factory and channel manifest. This surface is never part of the release default path. See docs/contracts/permissions.md and docs/architecture/browser-qa-surface.md.
- **MCP project**：同 ID 不覆盖 user 的 command/args/url/env；变更需 `needsRetrust` + 显式 trust；运行时连接按 `projectRoot + descriptorHash` 建立独立 ref-counted pool，handoff 只属于当前 Turn terminal result。
- **MCP transport**：仅 `stdio` / `streamable-http`；`sse` 配置 fail-closed（`MCP_TRANSPORT_UNSUPPORTED`）。Pool identity：`realpath + projectId + descriptorHash`；失败缓存指数退避；orphan pool quarantine。
- **RDC**：无内置 CLI 副本；Open `.rdc` 等垂直入口只走 Settings 配置的 CLI 与应用固定生命周期对接。Mission 只读面与 `rdc_probe` 见裁决 J。
- **RDC context lease**：仅 per-session lease（`setRdcRuntimeContextForSession` / `getRdcContextLease` / `assertRdcContextLeaseOwnership`）；**禁止** RDC global mirror、`legacyGlobalMirror`、`getRdcRuntimeContext` 全局 API。
- **Capture 所有权**：`ownerSessionId` 不匹配则 fail-closed；不跨 session 继承已打开 capture。
- **外部解释器**：`code_interpreter` 只执行 Settings `tooling.codeInterpreter` 配置的本机解释器（默认探测系统 Python）；不内置运行时，不挂 `rdcCli`，未启用 fail-closed。产物经 `RDC_INTERPRETER_ARTIFACTS_DIR` 扫描登记。
- **`read_image`**：`visionInputMode !== 'native'` 时 `VISION_INPUT_UNSUPPORTED` fail-closed，与附件 vision 输入一致。
- **图像预览单通道**：工具图只经 session `image-previews` + `conversation:getToolImagePreview`（Zod + active-session gate）给 renderer；大 base64 不进入 `resultPreview`。模型侧把 tool-result 图桥成紧随的 user image part，不静默丢图；卸货的原图写入受控 image artifact，JSON 清单只引用其 URI/hash，不把 base64 当文本 artifact 写入。用户附件缩略图走 `conversation:getAttachmentPreview`：staging 预览无 session；已提交附件必须带 `sessionId` 且过 active-session gate。
- **用户附件管道**：Composer `+` 只附加图片/文件（path 或 bytes 经 `conversation:stageAttachments`）。`.rdc`、可执行文件与 **SVG** 硬拒（SVG 不进 vision / inline）。Staging 写 `{userData}/state/staging/attachments/`，进程启动清空，preparing 失败不落 session。prepare 冻结最终 session 逻辑路径与 inline 文本；run 只补 image 字节。物化分层：image → native vision；text/pdf → tokenizer 预算 inline；binary → 元数据路径。当前 session `attachments/` 仅对 `read_file`/`read_image`/`glob`/`grep` 自动只读授权。禁止 `session:attachments:list` / `import` IPC。
- **session:// Artifact**：URI `session://<plans|investigation|tool-outputs>/<relative-path>` 只解析到 owning session 的 `<sessionPath>/session-artifacts/<category>/`。配额：文本单文件 2 MiB、原始图片 32 MiB，resolver 返回窗 200 KiB / 2000 行、模型侧 `artifact_read` 每页至多 16 KiB，自动卸货阈值 32 KiB（序列化后），session 合计 512 MiB，tool-outputs 最多 2048 文件；写入先对 incomingBytes（覆盖只计 delta）做 session 级 reservation，再 temp write / hash / atomic commit，失败回滚 reservation 并删除 temp；按磁盘 reconcile（丢弃未提交 reservation、清掉 `.tmp`）在启动 `initializeWorkspace`、session 打开/加载（`readSession` / `setCurrentSessionId`）以及 resolver 首次 read/write/list 时幂等执行；`artifact_read` 遇到卸货 envelope 时返回 payload 的 hash/size/mime 与 owner/source，不以 envelope 文件自身 hash 作为工具结果；MIME 白名单 text/plain、text/markdown、application/json、text/csv、text/yaml、image/png|jpeg|gif|webp；硬拒 SVG / 可执行 / `.rdc`。成功的 `rdc_probe` 只读查询即使低于卸货阈值也保留实际返回内容及截断状态的证据引用，委派仍需逐项授权。plans 活文件为 `session://plans/plan.md`（同意前覆盖写），同意后冻结为 `plan-<ISO>-<hash8>.md`；下一周期再写同一活文件。investigation 为调查记录。不进入 attachments 自动授权，`read_file` 不放宽。
- **Tasks 历史卡**：主回合进行时，每次 `task.created` / `task.updated` 在原事件位置保留一张不可被后续更新改写的任务卡；批量创建只记一张。提交时捕获列表状态，事件 ID 用于重放去重。最新卡默认展开、旧卡默认收起，手动开合优先。父回复结束后的后台 Task 更新只刷新所属子代理卡、mailbox 和右栏，不倒插父工作过程。canonical order 与派生状态由 main 侧 `taskProjection` 单点投影；右栏 Progress 单独显示最新状态，历史卡显示各自发生时的状态。
- **唯一 Turn Preparation**：产品回合经 conversation `prepareTurn`、Subagent 经 `ProfileTurnPreparation` 冻结 `preparedRuntime`，二者都只经 `sendProfileMessage` 执行；`AgentTurnRunner` 无 preparedRuntime 抛 `TURN_NOT_PREPARED`，无 fallback plan。
- **AgentState 复合键**：`sessionId|ephemeralScope` + `agentId`；renderer `agentStore` 与 IPC bridge 无 sessionId 的事件丢弃。
- **存储 fail-closed**：StorageIo 区分不存在、损坏和不支持的版本；不支持的版本保留原件。Run 只读 run.json v3，run.yaml 是写入投影；attachments.json 只读 schemaVersion 1 的对象，usage.json 只读 schemaVersion 2 的对象。Settings 只接受 schemaVersion 8 且拒绝已移除的 embedding 字段。缺版本、旧版本和仅 YAML 的 Run 明确报 STORAGE_SCHEMA_UNSUPPORTED，不自动迁移、改写或隔离原件；Settings 旧版本同样报错并保留原文件；当前版本结构不合法报 STORAGE_SCHEMA。其他仍有版本升级责任的文档按各自契约处理。写入走 atomic rename，deepMerge 拒绝危险原型键。目录锁对活 pid 永不回收；owner 无法读取时可能仍在初始化，等待并在超时后报错，只自动回收可识别的死 pid 锁。跨进程回收以独占标记串行化，取得标记后重新读取 owner；标记本身不能安全确认失主时等待并超时，不抢占。
- **结构化压缩**：仅自动压缩；产品不提供按钮、菜单、`/compact` 或 `/summary`。会话准备和执行途中复用 `PromptPlan → RequestEnvelope → adapter` 单轮、无工具的 model-generated `StructuredHandoff`（`derivation: 'model-generated'`）。LLM 失败显式报错（Availability recoverable），不静默回退确定性抽取。低于阈值或可见回合过短时返回 `status: 'noop'`，不写 `complete` 压缩工作块。
- **ToolValidator**：严格 JSON Schema 子集；只接受 `SUPPORTED_SCHEMA_KEYS` 白名单；未声明字段与未实现关键字编译期 ToolValidationError fail-closed（运行时为 `TOOL_SCHEMA_VIOLATION`）。
- **Orchestrator façade**：`AgentOrchestrator.ts` 保持 façade（少于 800 行，ESLint `max-lines`）；turn 准备、tool 装配、executor、turn/subagent runner、prompt-plan、memory UI 等职责外提到协作单元；值 import 预算见 `pnpm run check:orchestrator-facade`。
- **CSP**：生产 `script-src` 无 `unsafe-inline`；`style-src 'self'`（无 `unsafe-inline`）；`style-src-attr 'none'`；动态样式经 constructable stylesheet（`useDynStyle` / `assignDynStyle` / Appearance `applyChromeTheme`），不依赖 inline style attributes 或 `<style>` textContent 注入。Appearance chrome 权威见 [`docs/ui/design-system.md`](docs/ui/design-system.md)；Settings schema 8 保留经校验的用户主题配置。
- **IPC Zod**：全部 IPC handler 经 `parseIpcArgs`；非法 payload fail-closed；`approvalToken` 单次消费。
- **Session Projection**：主进程允许多 session 并行 turn；renderer 仅投影 `currentSession`；带 `sessionId` 的 IPC 流式/投影事件必须经 active-session gate，后台写入 `sessionProjectionStore`；Composer draft 恢复与 Stop/Rewrite monotonic 绑定 owning session/`requestId`。权威见 [`docs/contracts/session-projection.md`](docs/contracts/session-projection.md)；门禁 `pnpm run check:session-projection`。
- **EffectiveRuntimePlan**：`schemaVersion: 3`；在 `prepareTurn` **完整冻结**（`planId` / fingerprint / tools / skill ∩ / deferred / MCP hash / permissionConstraints / policy / `contextCompactionPercent` / route / request+prompt fingerprints / 附件 manifest 指纹）；Prompt 与 Executor 共用；在途 turn 不读可变 Settings；唯一动态授权输入是主进程成功提交的全局权限挡位 mode/revision，在每个工具最终准入前采样。
- **子代理可见记录**：一次委派以父 `subagent` tool call 为唯一 Work Process 卡片锚点；Tasks 快照仍是独立历史事件。子执行步骤在所属父会话中独立增量持久化，由 child session / Task execution / generation 关联；父消息只存关联与短状态。卡片默认收起，与普通 Tool 共用卡头、分隔线和正文边界；卡头呈现 Agent 身份、真实状态与耗时，第二行显示实际任务开头。展开后直接按冻结 capsule 字段排版委派原话，事实与引用、执行约束按非空数据折叠；下方独立折叠工作过程、最终回复和调用详情。完整实际发送载荷只在调用详情按需读取，不改变子代理收到的消息。运行卡首次展开自动打开工作过程，之后尊重手动开合；已结束卡首次展开保持下方各区收起。子过程与主过程共用事件和工具行渲染器，子过程使用紧凑密度，长载荷才有内层表面；`background_wait` 是可展开的轻量运行时事件。同步状态来自子执行，后台卡状态来自 Task Execution 生命周期，二者与 Task 状态、final 内容分别保存；无真实比例时只显示非确定性运行信号，终态停止计时与动效。子工具回执在相应工具行，调用详情保存父参数、回执、发送载荷、标识及排错信息；不推造隐藏推理。`maxChildDepth` 在全部启用策略未声明时默认 1，显式 0 禁止委派，多个显式值取最严格值；深度耗尽时准备、搜索和执行共用冻结的工具集。
- **子代理卡的单一呈现**：折叠时的单行任务预览与展开后的 capsule 正文互斥，不在同一卡内重复任务。非确定性点阵仅在折叠态出现，位于卡头分隔线下、渐隐任务文字右侧，与卡头状态、耗时、箭头所在列共用左右边界；展开时卸载预览和点阵。事实与引用、执行约束属于任务正文的二级分组。主子工具事件只保留一棵语义组件树，紧凑密度由样式控制，参数、原始回执、诊断和错误走同一组件路径。
- **工作记录单一路径**：委派正文与子过程投影共用同一纯文本脱敏入口；子过程只改变共享事件组件的密度。右栏任务定位通过 renderer 内部有类型的请求向工作时间线收集候选卡，先定位最新历史卡，再由窗口化列表展开、滚动和聚焦；该请求不成为 Task 状态来源或公共 IPC。
- **后台委派收束**：Task 完成、失败或发出报告只更新其持久记录、mailbox 与所属委派卡，不创建空 user 消息或第二条父 assistant 回复。父模型仅由显式用户请求或原本尚未结束的父 turn 驱动。
- **上下文预算**：`contextTierPromptCap` = `maxPromptTokens ?? maxTotalTokens`，不扣模型输出上限。压缩触发为 `min(用户 compactionThresholdPercent, policy.contextCompactionPercent)`（policy ≥100 不约束；结果 clamp 50–90 / 步长 5）。规划上限走 `resolvePlanningOutputTokens`（声明值 / 拆窗差值 / 窗口本身）。每次 LLM call 的 `max_tokens` = `min(规划上限, window − promptTokens − safety)`；缺省输出上限 = 剩余窗口，不把缺省写成 0。装不下先压缩再 `CONTEXT_CANNOT_FIT` fail-closed。

## Document Index

- `docs/contracts/` — [`runtime-kernel.md`](docs/contracts/runtime-kernel.md)（Agent loop、Prompt/Request、Reasoning、Tools、Session、Model capability）、[`session-projection.md`](docs/contracts/session-projection.md)（Active Session Projection、IPC gate、Composer 恢复、Stop/Rewrite monotonic）、[`permissions.md`](docs/contracts/permissions.md)（Permission mode、Sandbox、CSP、IPC Zod、Bridge、Secret、RDC lease、MCP trust、Shell）、[`failure-model.md`](docs/contracts/failure-model.md)（Security / Integrity / Availability）
- `docs/product/` — [`scoped-runtime-resources.md`](docs/product/scoped-runtime-resources.md)（Scope、Profiles、Skills、Hooks、Memory、Project Instructions）、[`RenderDoc Agent 完整设计书.md`](<docs/product/RenderDoc Agent 完整设计书.md>)（RenderDoc 领域目标；第 0 章为已定裁决）、[`acceptance-ledger.md`](docs/product/acceptance-ledger.md)（验收账本：真实运行证据）、[`README.md`](docs/product/README.md)（其余产品文档入口）
- `docs/ui/` — [`workbench-and-transcript.md`](docs/ui/workbench-and-transcript.md)（Workbench 轨、Work Process、Composer、Markdown）、[`design-system.md`](docs/ui/design-system.md)（Token、按钮、颜色、组件规则、Appearance 双体系）、[`work-process-checklist.md`](docs/ui/work-process-checklist.md)、[`appearance-checklist.md`](docs/ui/appearance-checklist.md)、[`knowledge-center.md`](docs/ui/knowledge-center.md)
- `docs/architecture/` — [`README.md`](docs/architecture/README.md)（模块地图与数据流入口）、[`browser-qa-surface.md`](docs/architecture/browser-qa-surface.md)（Browser QA 与桌面 channel 矩阵，debug-only）、[`rdc-runtime.md`](docs/architecture/rdc-runtime.md)（RDC 操作契约、lease、回放身份）
- `docs/workflows/` — [`README.md`](docs/workflows/README.md)；当前执行计划为 [`vertical-investigation-convergence.md`](docs/workflows/vertical-investigation-convergence.md)

### Renderer 架构

视觉定位与 Token 规则由 [`DESIGN.md`](DESIGN.md) 及其 UI 主题文档维护；本文件规定工程分层与运行时约束。

**渲染层分层**：`ui`（无业务原子/分子组件）→ `patterns`（跨 feature 复合，可读 store，不写 store、不直调 IPC）→ `features`（产品面，不横向 import 其它 feature）→ `app` / `shell`（编排与窗口 chrome）。`stores` / `services` / `hooks` / `lib` / `platform` 为被依赖层，不反向 import `features` / `ui` / `patterns` / `app` / `shell`。组件（`.tsx`）不直调 `window.electronAPI`。门禁：`pnpm run check:renderer-structure` + ESLint `no-restricted-imports`。

顶层目录：`app/`（App、bootstrap、WorkbenchShell、theme、contextMenu）、`shell/`（AppShell、TitleBar、ResizeHandle、UserMenu）、`features/`（`transcript` / `composer` / `right-rail` / `sidebar` / `settings` / `knowledge` / `terminal` / `captures` / `onboarding`，CSS 共置）、`patterns/`（含 Markdown）、`ui/`、`stores/`、`services/`、`hooks/`、`lib/`、`platform/`、`i18n.ts`（当前语言 React hook）、`i18n/`（`messages.ts` 纯翻译 + `locales/{en,zh-CN}/<feature>.ts`）、`styles/`（`design-*.css` 与 `global.css`、`global/`；`responsive.css` 仅放真 `@media`）。不存在 `pages/`、`styles/tokens/*`、`styles/base/`、`src/renderer/components`。

组件按职责和状态所有权划分：feature 专属效果与交互留在所属 feature；只有多个独立消费者共享的行为才上提为 pattern。Pattern 的业务写入经调用方传入回调，不通过取出 store action 间接写入。展示组件接收最小数据与动作；跨 feature 组合由 app 完成。组件样式就近维护，全局 CSS 只承载基础与全局布局；不使用数字分段文件或旧路径转发。结构重组保持已有视觉、交互与 IPC/持久化契约。

内部组件活文档复用生产视图和主题编译逻辑，独立开发入口不进入产品导航或发行包；组件示例不连接真实配置、模型或 RDC。通用披露/浮层几何在 ui/lib 收敛；Composer Max 特殊滑条及核心运行光效由所属领域持有唯一实现。

## Verification Gate（摘要）

文件行数由 ESLint `max-lines` 执行（`AgentOrchestrator.ts` < 800，main 单文件 ≤ 900）。CI 定义在 `.github/workflows/ci.yml`，覆盖 hygiene、typecheck、lint、test、coverage、`check:architecture`、各 `check:*` 门禁、`check:contracts`、build、browser-smoke、desktop-smoke 与双 OS launcher/pack。本地验证命令与完成标准见 `AGENTS.md` §5。`check:coverage-ratchet` 是固定底线（基线 `scripts/fidelity/coverage-ratchet.json`），只在大幅回退时失败。UI/工作流验收用 disposable `pnpm run start:agent-browser` 实例，流程见 `AGENTS.md`。

**Provider 失败诊断保真**（契约见 [`docs/contracts/failure-model.md`](docs/contracts/failure-model.md)「provider 失败诊断保真」）：`ProviderEmptyStreamError`（`PROVIDER_STREAM_EMPTY`）不合成 HTTP 502；`ErrorRecovery` 的 `empty_stream` 最多 1 次重试，真实 5xx 为 `server_error`（3 次），503 为 `overloaded`，401 立即 abort；`AgentRecoveryAbortError` 必带 cause 与结构化字段；`createTurnFailedDiagnostic` 保留 `CONVERSATION_LLM_REQUEST_FAILED` 并按 auth / quota-rate / 5xx / empty_stream / network 分类文案。Work Process Active Signal 与诊断行对齐见 `check:work-process` + [`docs/ui/work-process-checklist.md`](docs/ui/work-process-checklist.md)。

Settings 只读 `schemaVersion` **8**，经校验的 `appearance.chromeThemes` 用户配置保持有效；不支持的持久版本明确报错并保留原件。桌面窗口几何写入 `layout.window`（宽高/坐标/最大化），主进程在 resize/move/close 时持久化并在启动恢复；左右栏与 terminal 高度经 renderer `settings:set` 持久化。Browser 与 Desktop 走同一 Settings 持久化路径；Browser QA 默认使用经过校验并在退出清理的 disposable `os.tmpdir()/rdc-agent/qa-*` userData，只有显式 `RDC_AGENT_USER_DATA` 或 `RDC_AGENT_USE_CANONICAL_USERDATA=1` 才共享 canonical userData，`instance.lock` 阻止并发占用。

## 当前裁决

详细字段与领域流程见设计书；工程合同冲突以本节为准。以下约束全局成立：

- 无平台级 InvestigationGraph、第二 TaskStore 或第二 Agent Runtime。
- `TaskRecord.metadata`、`AgentProfile.metadata`、`ConversationMessage` 不带领域字段；垂直记录只引用 task id。
- RDC 操作集合不注册为独立模型工具，RDC 不是 MCP；RDC 是外部 CLI，无内置副本。**Live RDC** 要求冻结 `access-ceiling: full`、owning lease，以及 Settings 配置的 CLI 与结构化 `shell.rdc`。`read-only` 天花板的 profile（内置 Debugger / Analyzer / Optimizer）不能使用 `shell` 或 `code_interpreter`；它们用 `runtime_context` 读取会话身份，并在拥有 lease 时看到其中的 `rdc` 载荷，另用只读 `rdc_probe` 访问 RDC。Full access 不抬高天花板。
- Knowledge 持久写入仅 human review；`FullAccess` 不可绕过；无自动 Memory / Knowledge / Candidate / Promote。
- 新结构替代旧结构时直接收敛，不保留 legacy / deprecated shim。
- 禁止恢复 Embedding capability / Semantic lane / `settings.llm.embedding` / `EmbeddingCatalog` / `EmbeddingExecutionService`；Discovery 剔除 embedding modality，Embedding 模型不进入 Agent / Composer / subagent picker，Settings schema 8 拒绝 embedding 字段。
- 禁止恢复 ask/plan/edit 或 S0 specialist id 的运行通道与 custom manifest fallback。

### A. Builtin Profiles

四个默认顶层入口与八个默认内部 builtin 经同一有效快照加载；Settings、Composer 和 Conversation preflight 使用 project-aware 资源解析，资源读取不创建或改写 user seed。user/project 可覆盖合法 ID 或新增合法自定义 ID。Profile 冻结身份、模型、推理档位及默认 Skill；默认内部 Agent 经 Settings 配置并按需委派，Task 对必需执行和独立核验作真实准入。显式保存使用统一原子替换，sourceHash 为当前 Markdown 原始字节 SHA256。历史保留的拒绝 ID 诊断 `AGENT_ID_RESERVED_HISTORICAL`，不能通过保存、导入、路由或运行时激活。Run 结构见裁决 I。

### B. Right Rail

见下文「Right Rail Authority」，Project / Session 两个表面与 `investigation:read` 通道的合同均在该节。

### C. 已废止：Independent Embedding Capability

Embedding capability 与 Semantic lane 已删除，Knowledge 走 markdown-first 六 lane（裁决 G）。`check:knowledge-system` 为六 lane，并要求 embedding runtime 零命中。Settings 当前 schema 8 拒绝已删除的 embedding 字段；其他版本 fail-closed 并保留原件。禁止清单见「当前裁决」开头。

### D. Declared Continue and Execution Offer

`AgentHandoffDefinition` 是 UI 声明（label / labelTranslations / agent / prompt / send / surface / requiredSkillIds / requiredToolIds）。`surface` 省略等于 `turn-end`；`plan-gate` 只出现在计划门；`hidden` 不出现。旧字段 `showContinueOn` 解析即失败，不静默映射。计划批准写入 offer（source / target / 冻结 plan.uri+hash / 声明 requiredSkillIds）。人点建议行或计划门后，主进程 `applyDeclaredHandoff` 触发 `agent.before-handoff` / `after-handoff`，写入 `<sessionPath>/execution-offer.json`，并 persist `session.agentId`。`send: true` 表示声明交接确认后显式载荷经同一 Composer 链自动发送，`send: false` 才预填。General 就地终答，不自动回 Mission；用户用 Agent pill 或历史建议行切回 Mission。Pill 切换不写 offer、不预载调查 Skill。空 `handoffs` 合法（General 无按钮）。`handoff` / `agent` / `agent_handoff` token 拒绝，不静默映射到 `subagent`。不存在 `agent_handoff` 工具与 `prepared → committed → consumed` 状态机。打开会话时若仍有 `handoff-state.json`，只 unlink，不 parse。预载规则见「Plan 与 generation」。

### E. Investigation Vertical Schema

`rdc.investigation.v1` 只存在于垂直 Session Artifact，由 `InvestigationArtifactService` 管理；记录类型：`WorldState`、`EvidenceRecord`、`ClaimRecord`（Hypothesis 是 `claimKind`，Decision 内嵌）、`ExperimentRecord`、`ChallengeRecord`、`MissionCheckpoint`、`InvestigationArtifactManifest`。记录有稳定 id（`claimId` / `experimentId` / `challengeId` / `artifactId`）；`kind` 经闭集 Registry 解析到 `recordType + schema` 且正文通过校验。模型经四个 deferred 工具访问：`investigation_schema` / `investigation_read` / `investigation_write` / `investigation_list`。记录只写 session-owned Session Artifact；Artifacts 卡只投影该 namespace。仓库只用脱敏 fixture。

- **机器判定的系统不变量**：`S-CTX-01` / `S-STATE-01` / `S-CLAIM-01` / `S-CAUSAL-01` / `S-RDC-01`。认识论偏序 `unknown < inferred < derived < observed`；Confidence 与 Verification 分离。
- **`ready`**：结构化 `sourceRefs`（`{ artifactId, expectedHash }`）`>= 1`，各 `expectedHash` 与源当前 sha256 匹配，`contentHash` 等于 `contentRef` 正文字节 sha256；旧版本标 `superseded`。
- **`S-CLAIM-01`**：compact / report / view 投影 Claim 必须带 `compactProvenance`。
- **`S-CAUSAL-01`**：causal / counterfactual Claim 必须引用可解引用的 `ExperimentRecord`，且该实验 `intervention.type != none`、`status ∈ {recorded, rolled_back}`、`rollback.executed === true`、`rollback.baselineRestored === true`，并存在 verify evidence。
- **`S-RDC-01`**：mutate 必有 Experiment + exclusive world state + rollback / restored 验证，否则 `polluted` / `stale`。
- **领域边界**：Analyzer `claimKind` 不越 Observed / Reconstructed / Authoring 层；Optimizer 无 rollback 的 mutate 不得关闭。
- **事务**：record / manifest / index / supersede / stale-propagation 经 journal / temp-set / commit marker / atomic replace 同一事务；启动恢复只见完整旧版或完整新版；损坏/部分事务显式 `degraded`，不伪装 empty。
- **读取**：renderer 读取正文的唯一通道是 `investigation:read`；投影携带完整 `contentHash`。
- **方法与 Hook**：Agent 在 `.agent.md` 声明的默认 Skill 随准备实际预装，其他方法按需加载。三条 Mission 方法面接到 Coordinator / 方法 Skill / `mission-plan-handoff-check` / `report-contract` / Delegation Capsule 纪律。内置 Hook 为 `artifact-integrity` / `mission-plan-handoff-check` / `rdc-shell-audit` / `report-contract`。
- **完成合同**：见裁决 L。
- 门禁 `pnpm run check:investigation-system`。

### F. Concurrent Tools

`AgentTool.spec.isConcurrencySafe` 缺省 `false`，只有显式 `true` 才安全。`ConcurrentToolScheduler` 只并发同轮**连续**安全组；unsafe 独占。`shell` / write / task mutation / RDC（含 `rdc_probe`） / MCP / ask / `output_register` 与 `domainExtensions.rdc.requiresLease=true` 的 subagent 串行；RDC lease / shader replace / replay 不进入并发组，无并发 RDC 双 owner。offline subagent（未请求 `domainExtensions.rdc`）可进并发组。dispatch 前 `reserveDispatchBudget` 原子扣减，失败整组不开。结果按 `callIndex` 稳定回填；部分失败不连坐同组已发出调用，也不继续开新组；abort 以 `allSettled` join。

**Delegated lease**：`grantDelegatedLease` / `revokeDelegatedLease`。`domainExtensions.rdc.requiresLease=true` 的 child 在 turn 前取得 parent 上下文副本（`delegatedFrom`），同一 parent 同时只允许一条 live delegated lease，无 parent lease 则 fail-closed；child 完成 / 取消 / 抛错在 `finally` 立即撤销，parent lease 不变。未请求 `domainExtensions.rdc` 的 child 在 allowlist 编译期剔除 `rdc_probe` 与旧 lease 别名，保留通用 `runtime_context` 但不附带 `rdc` 载荷（`shell` 可保留，但不继承 parent lease）。普通 Capsule 省略领域扩展且没有 RDC Lease prompt 段；仅 RDC 模块接受 `domainExtensions.rdc.requiresLease=true` 并注入租约上下文；旧顶层字段拒绝。

### G. Knowledge

Knowledge 位于 `src/main/knowledge/`。主进程服务：`KnowledgeQueryService` / `KnowledgeIndexService` / `KnowledgeCompileService` / `KnowledgeCandidateService` / `KnowledgeWriteService`，另有 `KnowledgeImportService`、`KnowledgeExportService`、`KnowledgeReadService`、`KnowledgeTopicService`。Knowledge Center IPC 映射这些服务（含 `knowledge:import` / `knowledge:export`，均为 high-impact）。五个 deferred 工具 `knowledge_browse/search/read/compile/candidate_create` 与 canonical `knowledge` token 已注册；`$knowledge-scout` / `$knowledge-candidate` 是 builtin Skill；deferred 工具遵守真实 caller 与 skill 交集。Knowledge Center 为三列 UI（Spaces / List / Detail）。

- **六 retrieval lane**（markdown-first）：Identity/Path、Scope/Metadata、Lexical、Structural、Relation/Graph、Temporal/Version。
- **单一事实源**：`knowledge_*` 由 main-owned `KnowledgeIndexService` 提供；grep/glob/read 只是补充证据；无第二索引或 renderer 事实源。index revision 绑定 content hash。
- **读根**：`realpath(~/.rdc-agent/knowledge)` 与 `realpath(<projectRoot>/.rdc-agent/knowledge)` 对 `read_file` / `read_image` / `glob` / `grep` 免审批；写入经 `knowledge_*` + human review，`FullAccess` 不绕过。
- **durable store**：user `~/.rdc-agent/knowledge` 与 project `<项目>/.rdc-agent/knowledge` 是 canonical store；会话不是知识库，只存 Candidate/review（`<sessionPath>/knowledge-state.json`，跨进程锁 + revision，`KnowledgeDurableStore`）；卡片正文/index 在 space markdown + `KnowledgeIndexService`。
- **导入**：bounded path ingest 记录并复核源 hash/mtime/size，经 `KnowledgeImportService` + `KnowledgeWriteService` 经 realpath + 原子替换写入所选 user/project 空间 draft，无 raw 长期副本、无 session inbox。导入点击在同一次处理里签发并消费 `knowledge.write` token，不另弹确认窗。Historical Debug Case 经 canonical case card normalization 写入 draft，不默认或自动进入 Candidate；`fixed ≠ verified`。同源 `sourceHash` 幂等「已在该空间」，不同源同 ID 为导入冲突并带标题/已有 `cardId`，不进 Conflicts 页。仅当用户显式点击 / 命令，或 Agent 在本轮得到明确用户意图后显式调用 `knowledge_candidate_create`，才创建 Session Candidate；持久 Promote 仍只能 human review。
- **导出**：经 `KnowledgeExportService` + `knowledge:export`，格式为可再导入的知识包 `rdc.knowledge-package/1` 或阅读用途 Markdown；剔除 `sourceHash` / `sourceMtimeMs` / `sourceSize` 与绝对路径，复用导入同一套 secret 扫描，不导出凭据、provider 配置与会话数据；知识包再导入一律落目标空间 draft（`verified: false`），包内 `lifecycle` 只是元数据。
- Knowledge Center 的导入 / 导出 / 写入确认是叠加在三列之上的任务子弹窗，不替换阅读区。
- **版本合同**：Knowledge Center 与 Agent 工具读取同一版本合同：摘要可首次读取，章节、范围和全文须提供搜索或摘要返回的当前内容 hash；版本不符时要求刷新，不混用搜索摘要与变化后的正文。
- 无自动抽取 / 自动 Candidate / 自动 Promote。门禁 `pnpm run check:knowledge-system`。

### H. Legacy 清理

以下结构已删除或改写，禁止恢复：

- Ask / Plan / Edit 作为顶层身份、user seed 写入、把 Mission 标成 general executable 的 `AgentCategory`。
- 固定 Debugger harness stage、Classic Session Panel、第二套 Hook 实现。
- 把 RDC catalog 展开为模型工具、把 RDC 做成 MCP、向 `TaskRecord` 加 capture/evidence 字段。
- 平台级 Investigation Graph、第二 TaskStore、Mailbox / Blackboard。
- 交互式 Profile 导出选择面、把 `AgentHandoffDefinition` 当成 durable 状态、把 embedding 并入 agent catalog。
- 三卡或四卡 Right Rail。
- Ask/Plan/Edit 作为运行时 fallback、ask/plan/edit 运行通道、custom manifest fallback、Run v2 双读、Mission generic `shell`。
- Embedding 相关能力（禁止清单见本节开头）。

保留的相邻结构及其边界：

- `src/main/reports/ArtifactStore.ts`（`artifact_store.json`）是 `output_register` / Outputs 索引，不是 Investigation，不进入 Artifacts 卡。
- `src/shared/types/harness.ts` 只含 Outputs 的 `ArtifactKind` / `ArtifactRecord`；Investigation `EvidenceRecord` 以 `renderdocInvestigation.ts` 为准。
- `RdcCliInvokerService` 的 `tool_count` 仅作诊断，Right Rail 与模型工具面不展示 catalog summary。
- agent-trace `phases`（understand/work/summarize）是 Work Process / Trace UI 相位，不是 Run stage；`PhaseKind` 里的 `plan`/`execute` 是 trace node 词汇。
- `ErrorRecovery` 等 recoverable fallback 是 Availability 分类；`MCPManager` name-segment 在 `encode(decode(x)) !== x` 时 fail-closed，是 in-flight 协议需要。
- 产品状态统一为 Provider `retiring`、Knowledge `retired`；外部模型 ID/来源网址及 OpenAI-compatible 协议名保留原始语义。门禁 `pnpm run check:legacy-residue` 与 `pnpm run check:acceptance-ledger`。

### I. Run Schema v3

唯一活跃 schema 为 `schemaVersion: '3'`（`src/main/sessions/run/runV3/`）。Run 无 `lastStage`、`runtime.workflow_stage`、`WorkflowStage` / `WorkflowPhase`、stage constants / event / IPC / update API 与 `recommendedSpecialists`。权限 = effective `profileId` + frozen allowlist；Mission 身份 = `run.kind + mission + profileId`；生命周期 = `RunStatus` + turn transaction；用户进度 = `TaskRegistry` / `taskProjection`；方法进度 = Investigation records / checkpoints；输出阶段 = canonical `outputPhase`。运行时只读 v3 JSON，旧格式、缺版本、未知版本及仅 YAML 的目录明确报错并保留原件，不含转换器与双读。

### J. Mission 工具面

工具按 `observe` / `record` / `mutate` / `execute` 分类，天花板决定工具类，不按 profile id 维护第二份白名单：`read-only` 只留 observe 与 record；`workspace-write` 增加 mutate；`full` 才允许 execute（含原生 `shell.rdc`）；未知工具与 MCP 按 execute 处理。Profile `access-ceiling` 在 (1) profile allowlist 解析（token 展开后过滤）、(2) 冻结 EffectiveRuntimePlan executor、(3) AgentPermissionPolicy hard deny、(4) tool activation 四处同时执行；Full access 不能绕过。内置三 Mission 声明 `read-only` 与 `completion-contract: investigation-report`。

Mission runtime allowlist：

- 信息只读：`read` / `search` / `web`（展开后的只读文件/搜索/网页工具，不含 write/edit）
- 用户询问：`ask_user`
- 任务进度：`task_create` / `task_update` / `task_get` / `task_list` / `task_stop`（`task` token 展开时剔除 `output_register`）
- 制品：`plan_artifact`（人机门，与 `ask_user` 同构停顿）、`investigation_schema` / `investigation_read` / `investigation_write` / `investigation_list`
- 知识：`knowledge_browse` / `knowledge_search` / `knowledge_read` / `knowledge_compile` / `knowledge_candidate_create`（后者仅显式用户意图）
- Memory 只读：`memory_search` / `memory_read`
- Skill 发现：`tool_search` / `skills` / `skill_read`
- Subagent：`subagent`（父 manifest `agents` 白名单；Mission 默认可委派 `general` 和 `knowledge-scout`）
- 运行时身份：`runtime_context`（会话、scope、权限 revision；有 lease 时 `rdc` 载荷含回放身份，不把打开时的原始响应当作实时位置）+ 只读 `rdc_probe`。获批 Mission 使用实时 RDC 前，计划须冻结已登记输入和设备，即使只使用当前一份 capture；缺少该合同可继续离线工作和目录查询，但不能使用或委派 live lease，须经计划门修订。具备冻结范围的 owning General 的 `captureRestoration` 是带签名回执引用的入口基线，实时位置仍须实际查询。

**`rdc_probe`**：

- 唯一执行路径：Settings `tooling.rdcCli` 指定的同安装捆绑 Python 与 `cli/run_cli.py`（lease 仅当前 session）。只读 action 编译为真实命令；获批 General 的 capture 生命周期复用主进程会话服务。应用 session ID 不作为 CLI replay ID；拥有者 daemon context 显式绑定。
- 输入为 `enumerate` / `doctor` / `version` / `probe` / `preview_status`，以及获批拥有者的 `capture_select(inputId)` / `capture_restore` / `capture_recover`。模型不提供路径或 context ID；`probe` 仅允许共享闭集内只读查询（`context_status`、`resource_list`、`event_list`、`event_search`、`event_show`、`pipeline_show`、`vfs_ls`、`vfs_cat`），不接受任意 argv；`event_list` 按 `offset/limit` 分页，`event_search` 按名称、ActionFlags 与事件范围过滤。
- 输出：结构化 JSON（exitCode、原生结果、world-state 戳）；`rdc_probe` 不截断原生结果，超阈值整体制品化并返回 artifact ref，分页依据原生 `pagination.truncated`。raw `.rdc` bytes 永不进入模型上下文或 Provider。
- capture 切换与恢复经过当前权限和 policy、批准输入与设备、资源释放、身份重准备及签名回执；只读 Mission 不获得这些生命周期权限。
- General 需要 Live RDC mutate（shader replace、replay variant、timing experiment apply）时走 `shell` + Settings action，且必须持有 exclusive lease。

Mission 的禁止面：`shell`、`code_interpreter`、`write` / `edit` / `git` / `file-manage`、`output_register`、`memory_write` / `memory_delete`、session create/delete/rewrite/branch、model/settings mutation、generic filesystem、MCP tools、project/output/external mutation、任意未在共享只读查询闭集中的 RDC action。

### K. Hook Trust Fingerprint

Hook trust fingerprint = parsed definition + 所有 resolved 脚本/参数文件 bytes + canonical realpath + scope/provenance + PATH 解析后的 executable identity（`hook-trust.json` schemaVersion 2）。任一变化 → `needsRetrust`；仅 YAML 的旧记录首次加载失效并要求 retrust。user/project 必须显式 trust；builtin 默认信任，内容变化随仓库发布。12 canonical events 走单一 `HookEngine` 路径。

### L. Mission Completion Contract

普通对话不因自然终答自动完成 Investigation 或 Task。获批 Mission 计划由 General 继承对应领域完成合同；`completed` 经 turn / Mission 收口门禁检查必要 Task、当前版本核验、相关 open Challenge、活动子执行、可解引用的 `MissionCheckpoint`、ready report、canonical `final_answer` 与原现场恢复。`turn_complete.evidenceRefs` 精确引用当前 ready report 的 URI 和内容哈希；声明前检查该报告的完整领域合同，包括报告状态、所需实验与相关未解 Challenge，缺口作为工具错误返回；终答提交时重新核验相同引用与合同，用户正文不必重复内部标识。提前终答的缺口返回同一执行；真实停止或阻塞保留对应 disposition。`partial` / `inconclusive` / `blocked` / `cancelled` / `budget_paused` 不伪装 completed，不能只靠 Hook、模型文本或 `output_register`。合同闭合后 General 就地交付报告；需战略改变时保存缺口并由用户切回 Mission。未继承调查合同的普通 General 不受垂直门禁约束。

## Right Rail Authority

Right Rail 有两个按选择对象区分的表面。选中 Project 时**只**渲染项目级 `Import .rdc` 输入面与已导入 capture 列表，不读取 session runtime。选中 Session 时渲染五张不可折叠圆角卡 `Progress / Artifacts / Outputs / Context / Capture`：

- Progress 消费 canonical `taskProjection`，是单一规范列表（`RightPanelViewModel.progress: ProgressTask[]`），创建序，已完成项就地保留，与 transcript 同序同态；始终分离任务序号、状态与标题，完成不划线。
- Artifacts 只投影 main-owned `rdc.investigation.v1` Investigation Artifacts（不是 Working Directory 扫描，也不是 `output_register`）。`InvestigationArtifactRow` 携带完整 `contentHash`（renderer 只缩显）。
- Outputs 只接受 `output_register` 发布的用户输出文件，拒绝 inputs 与 plan；Investigation Artifacts 不混进 Outputs。
- Context 只含被冻结 Prompt 段或成功 tool result 证明的具体任务资源。
- Capture 在 session 中始终可见：诚实空态或 owner-session 操作面，保留 scoped `.rdc` 选择、Replay Device、open / close / 单一实际 EID 回放轨道 / refresh 与紧凑诊断。

Renderer 读取 Investigation 正文的唯一通道是 IPC `investigation:read({ sessionId, artifactId, expectedHash })`：分类 `read`；active project/session owner gate；内部唯一调用 `InvestigationArtifactService.readRecord`；只返回既有 max-bytes 内完整 record，超限 fail-closed；不接受 URI / 绝对路径 / generic artifact。

main-owned `RightRailProjectionService` 为显式 `{ projectId, sessionId }` 组装 `RightPanelViewModel`；renderer 只消费投影，不从 action events、全局 capture、工作目录扫描或 tool catalog 重建各卡。`RdcCliInvokerService` 的 catalog summary 不进入右栏。

密度与布局：Transcript Task 快照默认仅标题与真实状态，原因按项展开并保留历史定位。Artifacts 只显示 main-owned 最新五项名称，Context 只显示现有顺序前五项名称；超出时经「查看全部」弹窗访问，不撑长侧栏。制品整行打开预览，ID 复制位于预览 ID 区域；元数据与 provenance 留在详情。列表与预览沿用共享弹层栈及焦点管理。卡外壳在 empty / populated 之间不变；空内容用安静线框插图，有内容只增高本卡并在兄弟行间使用内部 hairline。Dock 在紧凑桌面宽度仍可用，仅在 `RIGHT_RAIL_DRAWER_BREAKPOINT`（920px）及以下或无法保住最小工作面时变为共享 overlay drawer。

静态门禁：`pnpm run check:right-rail`，只认五卡。验收记录见 `docs/product/acceptance-ledger.md`。

## Plan 与 generation

General 为默认通用工作身份。核心正文只负责可信上下文、授权、持续执行、Skill 发现与收口；领域名称可留在能力目录。renderdoc-investigation 按调查目标选择 Mission，普通术语问答不强制路由。Mission 策略采用 renderdoc-execution 的六块 Markdown 模板，按规模填写；Knowledge 相似性仅是检查线索。

独立审查结论、父级记录更新与最终接受是不同责任：通过现有 Task 与 Investigation 版本化交付，不建立额外结算状态机。工具正文投影已存的版本关系而不扩展读取授权。审批主进程来源/故障元数据仅解释结果，不改变授权或领域证明。

`handoffs` 只驱动建议行和计划门按钮。按钮名称来自声明的 `label` 与可选 `labelTranslations`，UI 不按 Agent 身份改写动作语义；译文只负责展示，批准和交接身份为 `agent + label`。人点后主进程 `applyDeclaredHandoff` 校验声明属于当前（或刚批准的）profile，写入/确认 session execution offer，触发 `before-handoff` / `after-handoff`，并 persist `session.agentId`（字段与状态见裁决 D）。

Plan 经 session artifact plans 类别版本化：同意前覆盖活文件，同意后冻结副本，历史文件不迁移或删除。prepareTurn 仅当本回合 `agentId === targetAgentId`、批准 handoff target 与本 Agent 相同、批准计划与 offer 的 URI/hash 一致时，预载声明 Skill，并向 PromptPlan 的 volatile runtime fact 写入已批准的交接身份和冻结计划引用。该事实用于区分历史规划消息与当前执行阶段，不授权工具或设备；权限走冻结 catalog 与交集。通用 turn 仅调用 TurnCompletionValidator。Big Loop 由 General 终答写缺口、用户切回 Mission、新计划、再批准、再点 Execute 组成；runtime 不按身份 / depth / 正文开下一轮。

### Task 预算与取消

Task 可通过通用 `executionRequirements` 声明必要执行方式、必需方法与独立性来源；`plan_artifact` 绑定必需 Task，并把主进程读取的要求快照纳入批准 hash。启动、实际准备和结算核对同一义务与执行来源，不以描述或 metadata 充当保证。重规划可在原计划门显式提出同一 Task 的定义修订，批准后保留原执行、root、消费和期限，不重开已完成 Task。字段、修订和完成门见 runtime-kernel。

通用 harness 的逻辑 Task、执行实例与 root budget 统一持久化在 TaskStore。Task 的创建回合归属由 runtime 写入可选 `creationTurnRef`；Stop 在 producer join 后取消仅由被停回合创建且尚未启动的 Task。直接执行、同步/后台子执行共享根预算；Capsule 只收窄 child-local 账本，重试恢复原执行已消费量和原 root 关联。预算预留持久化先于工具效果，父回复结束不重置账本。并发首次绑定同一 root 只合并一次；已绑定 root A 的同一 live ledger 请求 root B 时显式拒绝，保持原账本与观察者归属。

同一父回合的 `maxAggregateWallMs` 仅累计有子执行实际活跃的墙钟时间；父级独立取证的间隔暂停该窗口，并行子执行重叠时只计一次。首次委派前不消耗此上限；达到上限后不再创建子执行。此局部窗口不替代持久 root budget、Capsule 单次时限或取消/join 规则。

任务取消终态在实际 producer 与所属进程退出后保存；同 turn 取消请求不 self-join。用户在后续 owning 回合明确续跑时，可显式为同一 cancelled Task 创建下一 generation，旧执行终态、原预算与消费不变；取消续跑入口不在同回合复活、不自动恢复子树、不重开 completed Task。独立审查所需的来源成果失效或缺少结构化引用时，可在原来源 Task 上启动新执行以重建可核验结果，保留旧执行和原预算。声明续跑切 Agent 后的新回合是独立 turn，不继承未完成 handoff 取消令牌。字段与调用合同以 [runtime-kernel](docs/contracts/runtime-kernel.md) 的 Task 执行章节为准。

## Session Capture 内嵌回放

- 项目 RDC 列表为空时保持原 Capture 空态外观、文案与交互；不挂载新控件、历史或画面。非空时 Capture 内提供文件、设备、打开/关闭和唯一实际 EID 回放轨道。
- 人工与 Agent 共用同一个 CaptureReplayState、当前图片、事件列表和控件，不设双 Tab 或独立足迹浏览/播放界面。Agent 接管仅锁定人工操作，控件原位显示并跟随实际回放，释放后恢复操作且不自动 apply。后台证据存档保留，不作为第二套回放投影。Progress 不提供会话级停止按钮，沿用 Composer Stop。
- 完整文件扫描确认的输入列表独立提交和广播；最后一个 RDC 消失后，即使回放释放或足迹清理失败，也保持真实空态。清理待办单独持久化，不用旧输入列表保存恢复状态；扫描不完整或项目不可访问时不推断文件缺失。
- `RdcSessionService` 按 project/session 管理独立 `RdcSessionRuntime`。native daemon context 由 main 分配，与 inputId 不等价；固定生命周期由主进程生成原生 argv，不提供自定义 lifecycle action 或参数模板，返回身份不一致拒绝绑定。关闭失败、半开失败和未确认子进程保留 owning context，不清空其他 session lease。
- Android 设备由单个 session 独占，不抢占。Agent preparing 至 active turn 收口期间禁止人工改变回放；delegated child 未 join 与 native exit 未确认继续锁定。人工和 Agent 原生命令经过同一 context 队列。
- Open 加载可证的最终呈现颜色输出；事件滑条实际 apply。requested/applied/image EID、generation、revision 分离，迟到画面不重标为新事件。应用 preview 是 main 校验后交付的内嵌图片。独立 Tools CLI 的窗口输出是有效外部功能。
- 足迹位于 `<project>/.rdc-agent/replay/<sessionId>/<captureSha256>`，内容 SHA-256 与 lease 身份摘要分离。图片最大边 960 px，PNG 保持 alpha；session 256 MiB、project 2 GiB，到限停止保存、不淘汰旧证据。关闭保留历史；重启只恢复选择和历史，不自动打开或占设备。
- Android 呈现以 `remote_display` 回执为准：同安装原生回执 `presented` 必须匹配实际 EID、目标与新完成序号；`unsupported`、`unavailable` 和本地 `not_applicable` 不表示设备已同步。

Android 设备选择立即进入当前会话的准备生命周期：冻结同安装 CLI/catalog、分配 owning context、由 Tools 检查并安全修复/启动/连接服务。连接成功但未打开 Capture 是合法状态，不发布 capture lease 或伪造回放身份；Open 在同一 context/remote handle 打开文件。没有活动会话不连接，不使用 default/detached context 或全局 remoteId 交接缓存。已有回放换设备须先取得一次确认，核实旧 context 释放后再准备新设备；交互锁、恢复和原生退出未确认时禁止切换。设备发现、会话准备与 Capture 绑定分别投影，顶部和右栏只有一份主进程选择权威。设备面板只承载设备选择、连接进度/状态、诊断、重试/取消和断开；抓帧选择与打开归右侧 Capture 区域。选择设备即授权 Tools 自动安装、覆盖及必要的降级、卸载重装目标 RenderDoc helper（可能清除其自身数据）；变更前核对目标设备、包与服务身份；未知归属和 busy 不重装、不抢占。安装回执未决由 Tools 在同次连接预算内只读核验，确证目标安装后继续启动/握手；失败保留真实事实，用户通过重试连接恢复。借用服务不因应用退出被停止。连接保留到明确断开/切换/删除会话/实际断连/退出，切换页签不释放，重启不自动重连或安装。

### 自动审查与计划交接

计划批准由宿主确认的工具边界正常结束 owning 规划回合，不再请求规划模型补终答；已启动执行仍须 join，未开始调用 skipped。Conversation 验证同回合冻结计划和 execution offer 后接受该计划门退出，不冒充 Mission 完成或放宽普通 canonical final_answer 合同。交接沿声明按钮、offer 和发送队列，无新增持久状态机。审批授权来自 main-owned PlanReviewProjection 与运行时 reviewId，以持久 plan-state/历史/文件证明来源，不依赖仍存活的 Promise 或历史 streaming。正常、重开和重启恢复共用决定链，不自动执行或复活旧回合；活跃反馈返回原循环，恢复反馈是携带已核验计划引用的新用户规划请求。恢复边界见 session-projection 契约。
