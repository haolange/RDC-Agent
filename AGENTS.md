# AGENTS.md

## 范围

本文件只约束 `RDC-Agent` 仓库内的修改方式、文档治理和交付边界。

本仓库是面向 RenderDoc `.rdc` capture 的 Electron 桌面应用，核心代码分布在 `src/main`、`src/preload`、`src/renderer` 和 `src/shared`。若本文件与系统、平台安全规则或用户本轮明确指令冲突，以更高优先级指令为准，并在交付说明中指出采用了哪个约束。仓库内部文档之间出现冲突时，产品边界、架构边界和验证门禁以 `DESIGN.md` 为准，再同步修正文档。

## 修改原则

- 涉及 UI/UX、产品设计、架构边界、跨层契约、feature 拆分或验证策略时，必须先阅读 `DESIGN.md`，再阅读相关 `docs/contracts/*` 与 `docs/architecture/*`。
- **权威文件**：`DESIGN.md` 的 Architecture Principles / Authority Map；Appearance 与 token 执行摘要仍见下文「设计系统约束」。详细 UI 规格见 `docs/ui/workbench-and-transcript.md` 与 `docs/ui/design-system.md`。
- 根目录只放仓库入口、总体说明和跨层约定，不要把具体 agent、stage 或 tool 的领域规则重复写到仓库根。
- 仓库保持标准 Electron 应用布局，`Config`、`Saved`、`Intermediate`、`Binaries` 属于运行期或构建期概念，不要重新引入为仓库顶层源码目录。
- 涉及主进程、预加载脚本、渲染层、共享类型时，优先保持一次改动内联动更新，避免只改单层造成契约漂移。
- 新增或调整 agent 角色、工作流阶段、IPC 事件、共享类型时，必须同步检查 `src/shared`、`src/main` 和对应 UI 页面是否一致。
- 不要保留明显的 legacy 双轨入口、镜像目录或“临时兼容”文案。新结构替代旧结构时，直接收敛到单一路径；除非用户本轮明确要求兼容，否则不得为了旧字段、旧入口或旧语义增加兼容层、迁移 shim 或静默 fallback。
- 路径引用应以本仓库为基准，不要硬编码上游仓库的绝对路径。
- 不要把 Nexus、CodePilot、上游 Frameworks 或 Tools 仓库的路径、概念或兼容面直接写成本库前提；如需引用，只能作为明确标注的对照参考。
- 文档以中文为主，必要的英文术语保留原样，例如 `RenderDoc`、`.rdc`、`Electron`、`IPC`、`LLM`、`Debugger`、`Analyzer`、`Optimizer`。

## 执行纪律

- 默认在用户当前所在分支直接修改、提交和推送；除非用户明确要求新分支、PR 或隔离工作树，否则不得擅自创建或切换分支，也不得因为平台默认工作流而改变分支。
- 用户要求“提交”“上传”或“推送”时，以对应 Git 操作成功为交付完成点。GitHub Actions 等云端 CI 属于异步检查：触发后立即报告链接与当时状态，不得阻塞等待；只有用户明确要求守候、确认全绿或处理 CI 失败时，才持续监控并修复。
- 实现前必须先界定本次目标、可验证的成功标准、验证方式和关键假设。
- 遇到需求不明确或存在多种合理解释时，先按影响分级处理：
  - 会导致 data loss、公开 API/IPC/共享类型破坏、schema/workspace 迁移、安全/权限边界变化，或不可安全回滚的产品语义变化时，属于 Blocking Ambiguity，必须先停下来提出澄清问题。
  - 影响范围局限、可回滚、可通过测试或 smoke 验证的歧义，属于 Non-blocking Ambiguity，应显式写明假设、风险和回滚方式后继续推进，不要静默选择。
- 默认采用最小可行修改，不新增未被要求的功能、抽象、配置项、扩展点或兼容层。
- 只修改完成当前目标必需的文件和代码，每一处 diff 都应能对应到本次请求、验证失败或本文件已有约定。
- 新路径替代旧路径时，应同步删除旧入口、旧文案、旧默认路径或无意义兼容分支，避免留下 legacy / deprecated 双轨。
- 临时兼容只能在用户明确要求、外部不可控依赖强制需要，或无法一次性安全迁移时使用；采用前必须说明原因、边界、移除条件和验证方式。默认实现不得保留旧字段/新字段双写、旧入口/新入口双轨或 deprecated 分支。

## 代码与文档边界

- `src/main` 负责窗口、菜单、IPC、工作流编排和外部能力接入。
- `src/preload` 负责受控暴露给渲染层的 API。
- `src/renderer` 负责界面、交互、状态展示和用户入口。
- `src/shared` 负责跨层共享的常量、类型与工具函数。
- `docs/` 只放稳定设计说明、流程说明和使用文档，不要把运行时代码规则写回文档层。
- `docs/` 下的正式文档按稳定主题归类到 `contracts/`、`product/`、`architecture/`、`workflows/`、`ui/`。
  - `contracts/`：runtime kernel、permissions、failure-model 等跨层契约（DESIGN 分拆权威）。
  - 产品/架构冲突以 `DESIGN.md` 裁决，再同步 `docs/**`。
- `resources/` 只放需要随应用分发或运行时依赖的资源；`scripts/` 只放可复用的开发脚本。

## 运行时模块与安全边界（Phase 0–6）

涉及下列模块时先读 `DESIGN.md` 与 `docs/contracts/*`，再改代码：

| 模块 | 路径（示意） | 边界 |
| --- | --- | --- |
| `ProcessSupervisor` | `src/main/runtime/` | 子进程 spawn/joinAll；仅在观察到 close/error 后移除 registry；超时未确认保留 `unconfirmed_orphan`；`code_interpreter` 走 `shell` owner；agent `shell` 工具走 `agent-shell` owner |
| `ToolImagePreviewStore` | `src/main/conversation/ToolImagePreviewStore.ts` | session `image-previews` 缩略图；IPC `conversation:getToolImagePreview` 只读 + active-session gate；magic bytes 拒伪 |
| `AttachmentStagingService` | `src/main/conversation/AttachmentStagingService.ts` | Composer 附件 path/bytes 暂存；硬拒 `.rdc`/可执行/SVG；path 源先 `stats.size` 再读；累计配额 + TTL；预览走 `conversation:getAttachmentPreview`（realpath + composer scope） |
| `tooling.codeInterpreter` | `src/shared/types/settings.ts` + Settings Tools | 本机边界、project 不可覆盖；未启用 `CODE_INTERPRETER_DISABLED` |
| `tooling.shell` | `src/shared/types/settings.ts` + Settings Tools | 本机边界、project 不可覆盖；空路径则 `ShellResolver` 自动探测（Windows：pwsh 7 → 5.1；POSIX：`$SHELL`∈zsh/bash/sh/dash → `/bin/zsh` → `/bin/bash` → `/bin/sh`）；fish/csh/nu 等 fail-closed；全失败 `SHELL_UNAVAILABLE`；Settings 只读诊断走 `settings:getResolvedShell` |
| `TurnCoordinator` / `TurnHandle` | `src/main/workflow/debugger/` | 每 session 活跃 turn；generation 丢弃迟到 event |
| `ShutdownCoordinator` | `src/main/lifecycle/` | before-quit 限时 shutdownAll |
| `MemoryStore` | `src/main/agent-runtime/memory/` | 进程内 realpath 队列 + `.memory.lock`（`directoryFileLock`：活 pid 永不回收，死 pid / 损坏锁回收）跨进程互斥 |
| `StorageIo` / `storageSchema` | `src/main/sessions/` | zod runtime 校验 + `schemaVersion` migration registry；未知更高版本 `STORAGE_SCHEMA_UNSUPPORTED`；`attachments.json` 现写 `{ schemaVersion, attachments }`，缺版本纯数组仍 Zod 校验；`usage.json` 现写 `{ schemaVersion: '2', usage }`，v1 `outputReserveTokens` 经 `SESSION_USAGE_MIGRATIONS` 迁到 `maxOutputTokens`；`context-view.json` 现写 `{ schemaVersion: '1', view }`，缺版本裸 view 经 `SESSION_CONTEXT_VIEW_MIGRATIONS` 包一层 |
| `SessionContextJournal` | `src/main/conversation/SessionContextJournal.ts` | canonical 中性历史；`ContinuationReplayPolicy` 同绑定回放 / 跨绑定 drop；optional 制品 8 轮 retention，`requirement: required` 豁免窗口、只随 compaction 终止；切模型不自动 compact |
| 结构化压缩 | `src/main/agent-runtime/context/` | `/compact` 与预算触发共用 LLM `StructuredHandoff`（`derivation: 'model-generated'`，经 PromptPlan 单轮无工具）；失败不静默回退；低于阈值返回 `status: 'noop'`，不写 complete 工作块 |
| 上下文预算 / 压缩阈值 / 动态输出上限 | `src/shared/utils/contextBudget.ts` + `contextTiers.ts` | prompt 上限不扣输出；压缩百分比 `min(用户, policy)`；每次 LLM call 现算 `max_tokens`；门禁含 `check:fidelity` 与 Browser QA 分段条压缩线 |
| `EffectiveRuntimePlan` | `src/main/agent-runtime/` | `schemaVersion: 3`；`prepareTurn` 完整冻结（含附件 manifest 指纹）；Prompt 与 Executor 共用 |
| `taskProjection` / `TaskRegistry` | `src/main/agent-runtime/tasks/` | `orderTasks` + `projectTaskItems` 是 Tasks 唯一顺序与派生状态；`listTasks`、事件 snapshot 与 Right Rail Progress 都消费它；任一侧不得再排序或按状态分区；`task_create` 唯一批量形状 `{ tasks: [{ subject }] }` |
| `LoopProgressGuard` / `AgentLoopTerminationError` | `src/main/agent-runtime/agent/` | 第二轮相同工具结果注入不落盘纠偏；第三轮 `AGENT_NO_PROGRESS`；仍需 continuation 的 max-turn 抛 `AGENT_MAX_TURNS_EXCEEDED`，不得静默完成或误报 Provider failure |
| `AgentOrchestrator` | `src/main/workflow/debugger/AgentOrchestrator.ts` | façade 少于 800 行；职责外提；`pnpm run check:orchestrator-facade` |
| `RdxRuntimeContextRegistry` | `src/main/sessions/` | **仅** per-session lease；禁止 `legacyGlobalMirror` / `getRdxRuntimeContext` |
| Session Projection | `src/renderer/stores/sessionProjectionStore.ts` + `sessionEventGate` | 仅投影 `currentSession`；IPC 事件须 gate；后台 cache；Composer restore / Stop / Agent 运行态绑 `sessionId + requestId + agentId`；`pnpm run check:session-projection` |
| Session `modelOverride` | `SessionRecord` + `session:setModelOverride` + `resolveAgentRoutePreflight` | 当前对话模型（Agent 路由仅作未点选种子）；Composer 底栏与 `/model` 共用同一套 EffectiveCatalog + `isAgentToolExecutableModel` 可选集；未 override 是显式可选状态（「按 Agent 配置」/ `/model default`）：有 session 写 `null`，无 session 清草稿；Agent route 不可执行时禁止清除；无 session 时只记草稿，不建 session；切 Agent **不清**模型；**不传** sub agent；注入点在选出 route 之后、查 EffectiveCatalog 之前；Agent/Composer 选择器仅纳入 `toolCalling.state === 'supported'` 且具备已实现 structured-tool adapter 的模型；`unknown`/`unsupported`/`unavailable`/`internal`/disabled fail-closed，不静默回退；Settings catalog 仍展示完整可审计事实；发送时 RequestPlanner 再校验可执行性 |
| `bridgeSecurity` | `src/main/browserAppBridge/` | **仅** `RDC_AGENT_BROWSER_QA=1`；bearer + Origin + canonical renderer channel + 已注册 handler；未知/内部/明文 secret channel fail-closed |
| `McpTrustService` | `src/main/settings/` | project 不可覆盖 user executable；needsRetrust |
| IPC Zod | `src/main/ipc/validation/` | **全量** handler `parseIpcArgs`；approvalToken 单次消费 |
| `ShellCommandRiskAnalyzer` | `src/main/agent-runtime/permissions/` | 风险分类器**不是**安全边界，最高只评 `high` 做审批路由；PermissionPolicy + `shellHardDeny` 才是 enforcement；硬拒绝按平台分集 |
| Secret / `safeStorage` | `src/main/settings/SecretStorageService.ts` | 不可用则 fail-closed；禁止明文 IPC；对外仅 `{ hasSecret, maskedPreview? }` |
| Electron sandbox / CSP | BrowserWindow + preload | `sandbox:true`；permission deny-by-default；CSP：`style-src 'self'`（无 `unsafe-inline`）+ `style-src-attr 'none'`；动态样式走 constructable stylesheet（`useDynStyle`） |

失败语义三分类见 `docs/contracts/failure-model.md`（Security fail-closed / Integrity degrade-safe / Availability recoverable）。多 skill 工具面：`allowedTools = ∩(skill_i) ∩ runtimeAllowlist`。

Phase 7 contract 测试入口：`src/main/testing/contracts/*Contract.test.ts`（security / concurrency / cancellation / storageFault / providerWireFixture / faultInjection）。覆盖率：`pnpm run test:coverage` + `pnpm run check:coverage-ratchet`。Orchestrator 行数契约：`pnpm run check:orchestrator-facade`（`check:architecture` 依赖链已接入）。

### 目标态 / 迁移中模块（尚未实现）

| 模块 | 路径 | 边界 |
| --- | --- | --- |
| `ProfileHandoffState` | `src/shared/types/profileHandoff.ts` + `src/main/sessions/handoffStateSchema.ts` + `src/main/sessions/HandoffStateStore.ts`（`<sessionPath>/handoff-state.json`） | 字段 `handoffId/lifecycle/sourceTurnId/sourceRequestId/sourceAgentId/toAgentId/chainRoot/depth/prompt/label/declaredModel/timestamps/cancelReason`；`declaredModel` 字段必存在、值可为 `null`；`prepared`=工具成功，`committed`=源 turn complete，`consumed`=目标消息 commit；`send:true` 自动续跑；每用户 root 链最多 3；重启降级手动；Stop/Rewrite/branch/手动切换取消；审批不继承；同 session 一活跃；非法 model fail-closed；模型优先级始终 session `modelOverride` > 通过 `isAgentToolExecutableModel` 校验的 handoff `declaredModel` > target route。现有 `AgentHandoffDefinition` **不是**该状态机 |
| `EmbeddingCatalog` / `EmbeddingExecutionService`（目标态 / 迁移中） | 独立 embeddings protocol/adapter | manifest `embeddings` → catalog → execution；opaque credential `operation=embed`；consent 默认关；semantic `unavailable/stale` fail-closed；identity/dimension/chunker/corpus hash；显式 rebuild。**不得**进入 Agent/Composer/subagent picker；Discovery agent modality 边界不放松 |
| Knowledge 五服务（目标态 / 迁移中） | `src/main/knowledge/`（目标路径） | `Query/Index/Compile/Candidate/Write`；七 lane；持久写入仅 human review；ColdData 摄入为 staging/Draft，**不自动 Candidate**；`fixed ≠ verified`。当前只有 `KnowledgeBrowseService` 只读浏览，不得把五服务写成已完成；`check:knowledge-system` ratchet 已建立、目标债务未清零 |
| Investigation 垂直 schema（目标态 / 迁移中） | Session Artifact only，namespace `rdc.investigation.v1` | `WorldState` / `EvidenceRecord` / `ClaimRecord`（含 `claimId`+`experimentId`） / `ExperimentRecord`（含 `experimentId`） / `ChallengeRecord`（含 `challengeId`） / `MissionCheckpoint` / `InvestigationArtifactManifest`；不侵入 `TaskRecord` / Profile / Message。`check:investigation-system` ratchet 已建立、目标债务未清零 |
| 并发工具组（目标态 / 迁移中） | executor（路径待实现） | 缺省不安全（仅 `isConcurrencySafe===true`）；只并发连续安全组，unsafe 独占；`shell`/write/task mutation/RDX/MCP/ask/handoff/output 串行；`callIndex` 稳序；dispatch 前原子预算；abort `allSettled` join；部分失败不连坐；offline subagent 需 `requiresRdxLease=false` |

## UI / UX 约束

- UI/UX 迭代必须关联 `DESIGN.md`：先确认本次改动是产品变更、结构保真迁移，还是缺陷修复，再决定验证范围。
- 默认以现有 UI/UX 效果保真为准，不要借重构、整理、命名收敛或类型迁移之名改变既有布局结构、交互路径、信息层级和视觉节奏。
- 涉及页面结构、面板布局、状态展示、样式引用或视觉资源路径时，必须确认属于明确的产品变更；如果不是，应保持现有效果不变。
- 修复结构问题时，不要顺手做与任务无关的视觉改版、布局重排或交互重定义。
- 涉及 `src/renderer` 的改动，除检查类型和功能外，还要检查界面入口是否完整、关键面板是否可渲染、现有交互是否可达。
- Settings 内 General / Appearance / Workspace / Models / Agents / Skills / Tools / Hooks / Policy 为同级导航，顺序即此；左侧导航顶部有深度搜索（section + 字段标题 + 中英关键词），命中后跳转并高亮目标控件，方向键 / Home / End 为 roving tabindex。Appearance 承载 System/Light/Dark、Light/Dark 独立 chrome（预设、accent/surface/ink、contrast、字体、Import/Copy `rdx-theme-v1:`）、`fontScale`、`composerMarkdown`、`usePointerCursors`、`reduceMotion`；Language 留在 General。禁止恢复 translucent / semi-transparent sidebar。禁止恢复 `oklch-themes.css`、`styles/tokens/*` 双轨或解析 `codex-theme-v1:`。scoped 编辑条不展示装饰性 “RDX Runtime” kicker；User | Project 独占作用域行且横向 `1fr 1fr` 拉满均分。Skills/MCP/Hooks/Policy 内容区为 Import + New 列表与右侧详情编辑器；Policy 内容区顶部另有用户级 Agent Runtime 块（压缩阈值 50–90、步长 5），项目 policy `limits.contextCompactionPercent` 只能收紧。Agents 不在 scope 条上放 New（仅 Agents 工具栏 Import + New Agent）。禁止恢复 Settings「诊断信息 / Diagnostics」导航；禁止把 Request Inspector 挂到 Work Process 或右侧默认 Session/Trace 面板。Workspace「RDX Runtime 根目录」与 Control Panel「RDX 运行时上下文」职责不同，不得一并删除。
- Composer 底栏右侧在 Effort 之前有当前对话的 Provider→Model 按钮（搜索、按 provider 分组）；搜索栏下常驻「按 Agent 配置」（不参与搜索过滤）；pill 仍显示实际生效模型名，仅 `.is-override` 区分覆盖态。永远可点，无 session 时只记草稿，切 Agent 不清模型，不写回 `.agent.md`。`/model default` 与该行共用清除路径。底栏弹窗（Agent / Permission / Effort / Usage / Model）走单一互斥注册表：任意时刻只开一个，Escape 关闭并把焦点还给 trigger，点空白关闭。
- subagent 工具可选 `model`（canonical `providerId:modelId`，冒号）；不在 EffectiveCatalog available 或 `pickerVisibility === 'internal'` 则 fail-closed，不继承父 session override。

## 设计系统约束（agent 写 CSS 必读）

**权威文件**：[`docs/ui/design-system.md`](docs/ui/design-system.md)（Token / 按钮 / 颜色 / 组件规则 / 视觉参考）。本节仅保留高层原则。

- **必须**引用语义 token（`--token-*`），禁止直接用 primitive token；字号用 `var(--text-*)`，间距用 `var(--space-*)`。
- 全局唯一按钮系统：`.button` + variant 修饰类；React 层用 `<Button>`。
- 颜色双体系：全局 chrome vs Composer agent accent；详见 [`docs/ui/design-system.md`](docs/ui/design-system.md) 与 [`docs/ui/appearance-checklist.md`](docs/ui/appearance-checklist.md)。
- 新组件必须覆盖所有交互状态、通过 CSS 变量控制 variant、不使用内联 style、文件行数 ≤300/200。
- 视觉参考：`designs/rdc-agent-design-system/Design System Preview.html`。

## 浏览器真实会话边界

- agent 日常 UI/功能验证默认使用 headless Browser QA：`pnpm run start:agent-browser`（`RDC_AGENT_HEADLESS=1` + `RDC_AGENT_BROWSER_QA=1`），每次默认使用经过校验的 disposable `os.tmpdir()/rdc-agent/qa-*` userData；只有显式 `RDC_AGENT_USER_DATA` 或 `RDC_AGENT_USE_CANONICAL_USERDATA=1` 才进入真实共享数据。再用主进程日志输出的 **one-time `http://127.0.0.1:<port>/qa?qaBootstrap=...`** 打开同一套 renderer（`/qa` Set-Cookie 后进干净同源 `/app`）。**优先 `/qa`**；桥接鉴权不接受任何 URL token；`browser-dev` 下 Vite 由 bridge 同源反代（含 HMR），不得直开 Vite 端口、无跨端口 challenge；`high-impact` channel（含 `command:execute`、`settings:set`、MCP trust/revoke 等）在无 `RDC_AGENT_BROWSER_QA_FULL_ACCESS=1` 时必须 fail-closed；`desktop-only` 永拒。门禁：`pnpm run check:browser-capability`。
- 浏览器真实会话通过 localhost bridge 连接真实 `main process`、workspace、settings、LLM runtime、事件流和已配置的 RDX CLI invoker；不得新增渲染层本地样本或演示场景作为验收入口。
- Bridge 为 **debug-only** 安全边界（`bridgeSecurity`）：非 `RDC_AGENT_BROWSER_QA=1` 不得启动，且**不进 release 默认路径**。Browser 与 Desktop 必须共用 `src/shared/renderer-api` 的唯一 `ElectronAPI` 工厂、channel manifest 与 main handler registry；所有 preload 公开产品能力均保持 parity，未知/内部/未注册 channel 及不存在的明文 secret 读取 fail-closed。矩阵见 `docs/architecture/browser-qa-surface.md`。
- Electron 窗口通过 `preload -> IPC transport` 进入主进程；浏览器真实会话通过 `localhost HTTP/SSE transport -> IPC handler registry` 进入主进程。除 transport 与原生窗口容器外，两条路径的 API、状态、持久化与审批语义必须一致，禁止恢复手写 Browser API、拒绝桩或第二套 channel 规则。
- 涉及 UI/UX、布局、消息流、状态展示、样式、面板可达性的改动，优先用浏览器真实会话和内置浏览器点击/截图验证。
- 产品级浏览器评审必须至少覆盖：Workbench 初始状态、Project/Session 入口、`.rdc` 导入或打开状态、Settings > Providers、Settings > Agents、语言/Appearance 持久化、Terminal、Memory approval、Tool Approval、Command、MCP/Hook trust/revoke、桌面与窄屏视口、水平溢出检查、长路径/中文文件名显示、按钮 disabled/active 状态和前后端数据一致性；未知/内部/明文 secret channel 的 fail-closed 面须单独抽检。
- 约 390px 窄屏验收必须确认 `.app-body` 不保留桌面最小宽度、Composer 控件无重叠且全部可达、Agent / Permission / Effort / Usage / Model 菜单仍在 viewport 内且不越界、selected/running 语义分离、Arrow/Home/End/Escape 与焦点返回正确，并在 reduced-motion 下确认运行状态点不播放动画。
- Composer 性能回归：先经 `/qa` 进入后在同源加 `?qaPerformance=1`（或带有效鉴权打开 `/app?qaPerformance=1`），读取 `data-rdc-qa-performance`；以原生 Event Timing 的 click-to-next-paint p95 和 Long Task 为准；16 ms 以下未上报 entry 按阈值保守计入，不支持 Event Timing 时 fail-closed。不得用 Browser 工具调用往返时间或后台节流的 RAF cadence 替代 renderer 指标；默认 `/app` 不得安装该探针的 listener 或 observer。
- 本地契约烟测：`pnpm run smoke:agent-browser`（失败 exit≠0；不并入默认 pack）。
- 涉及 `src/main`、`src/preload`、窗口、IPC 注册、workspace 权限、RDX CLI invoker 或 `RenderDoc` 本地链路时，补真实启动检查或内置浏览器真实会话；禁止把 Playwright/Electron E2E 作为门禁。

## RDX CLI Invoker 边界

- 本仓库不保留内置 RDX tool 副本，不把任何 tool bridge、MCP server 或仓库资源目录作为默认执行链；RenderDoc/RDX 能力必须来自系统安装或用户配置的外部 CLI。
- Open `.rdc`（local `openCapture` / remote `openRemoteCapture`）、connect remote、preview、close runtime 等垂直入口必须经 Settings 中配置的 RDX shell action 进入 `ShellInvocationService`；不得在主进程、preload、renderer 或打包配置中写死 CLI 命令、catalog 路径或仓库 fallback。
- 新增 RDX CLI 配置项时必须同步 `src/shared/types/settings.ts`、`SettingsService` sanitize、Settings UI 和文档；不得在调用点硬编码命令、catalog 路径或环境变量。
- renderer/preload does not expose arbitrary tool execution. Right Rail UI reads only the main-owned trace projection and its session-scoped `.rdc` runtime context; it must not display CLI catalog, tool count, or namespace inventory. Actual execution remains in main process policy through the configured external CLI.

## 产物与命名治理

- 不要把构建输出、测试输出、日志、workspace 本地数据、缓存文件或临时调试文件提交到源码目录或根目录。
- 源码依赖统一使用 `pnpm@11.7.0`；`pnpm-workspace.yaml` 将 store 固定到 `~/.cache/rdc-agent/pnpm-store`。不得新增 npm/Yarn lockfile、npm fallback、盘符根目录 store 或第二套启动路径。
- `node_modules/`、`out/`、`release/`、Electron 下载缓存和 launcher prepare state 只属于本机开发/构建期，永不入库；发布包不得包含 pnpm、lockfile、源码 launcher 或开发缓存。`pnpm-lock.yaml` 必须留在仓库以保证可复现安装。
- 根目录非隐藏文件由 `pnpm run check:repository-hygiene` 的允许名单强制约束；禁止根临时脚本、日志、零字节垃圾文件或含义不明的实验文件名。新增根文件前必须先更新该门禁。
- 禁止恢复 `cli/` 独立入口、Playwright `e2e/` 目录或 `docs/handover/`。UI/UX 验收走 `pnpm run start:agent-browser`；探索结论沉到 `DESIGN.md` 或正式 `docs/*` 主题，不另开 handover。
- `designs/` 只保留可交互的 `rdc-agent-design-system`；评审原型落地后删除，不长期双轨。
- 新增目录、脚本和文档时，命名应表达稳定职责，不使用临时性、讨论式或个人化命名。
- 不允许提交 mojibake/乱码文案。若终端显示异常，先用文件搜索或十六进制/编辑器确认真实字节，再决定是否修复。
- Agent Runtime 的用户资源根固定为 `~/.rdx`，项目资源根固定为 `<project-root>/.rdx`。不得新增可配置 workspace root、旧目录 fallback、双写或静默迁移。
- Project Scope 必须覆盖 agents、skills、MCP、hooks、policies、knowledge 和 memory；RDX CLI action 与 secret 仍属于本机边界，不能由项目覆盖。
- Prompt 调用链必须经 `PromptPlan -> RequestEnvelope -> provider adapter`。新增上下文来源时必须提供 scope、source、hash、precedence 和脱敏策略。
- Progressive Skill 面：非空 skill 短索引由 `SkillCatalogBudget` 注入；强制 preload 仅来自 `.agent.md` `skills`、composer `$skill` 与 session-scoped `/skills` 武装；`skills`/`skill_read` 保持 `core`。禁止恢复 lean/standard/`harness` 档位 UI 或整段省略 catalog。
- Provider 输出必须先获得稳定 `ProviderOutputRef`；同一 source ref 只能归属 `thinking`、`text`、`tool_call` 之一。kind collision、start 前 delta、close 后 delta、terminal 后语义事件必须 fail-closed，禁止按文本相同/相似做跨通道去重或 UI 隐藏。
- 普通 assistant text 永远不能合成为 thinking。commentary/final 仅由 canonical `outputPhase` 决定；只有 `final_answer` 可写 assistant 正文和 final trace，正常结束但无 canonical final 必须报诊断，禁止用 thinking/commentary fallback。
- Provider/Model 基线事实只能写入 `src/shared/provider-catalog/manifests` 的严格 JSON；TS 只实现 Schema、compiler、Registry、Resolver、Planner、adapter、auth、discovery 与 user-override。Manifest 是**基线真值**，Discovery 是**候选验证**，用户覆盖（`models.json`）是**显式覆盖，自带 provenance**，三者合并为 EffectiveCatalog。用户覆盖禁止触及 route.protocol、authSchemaId、adapterId、compatibilityGroup、carrier 等安全/延续性字段。禁止恢复 TS preset、factory 推导、名称/后缀/上游 SDK 包元数据/hostname 猜测或 renderer 静态 Catalog。
- 禁止恢复 image/video 生成 runtime、`MediaRuntimeService`、catalog `image` category、`image-generation` / `video-generation` capability，或无调用方 `adapter-not-implemented` 伪服务；discovery 继续 fail-closed 剔除非 agent modality。用户附件 vision-input 不受此禁。
- Fast、Reasoning Max、Max mode 与 variant 必须由 `ControlDefinition + ExecutionBinding` 编译；可选控件没有唯一可执行路径时 fail-closed。认证 secret/header 只能进入主进程 opaque credential lease，不得进入 manifest、Route、RequestPlan、IPC 或 Trace。
- Memory 写入必须由明确用户意图或交互审批触发；禁止恢复轮次自动抽取、自动 consolidation 或全索引 prompt 注入。


## Right Rail single-track gate

- The right rail is driven only by the main-owned `RightRailProjectionService` and its `RightPanelViewModel`. Progress and the transcript task snapshot share the same canonical `taskProjection`; neither side may sort or partition again. Renderer code must not rebuild Progress, Artifacts, Outputs, Context resources, or Capture state from action events, global capture state, working-directory scans, or tool catalogs. internal runtime identifiers are reserved for owner-scoped agent consumption, and raw diagnostic detail must not become sidebar inventory.
- The selected Project rail is only the project-scoped `Import .rdc` surface and imported-input list; it must not read session runtime state. This Project contract is already current and remains the target.
- Session rail **当前态（Wave 迁移事实）**：四张不可折叠圆角卡 `Progress / Outputs / Context / Capture`。这是现有 UI 与 `check:right-rail` 的当前合同，实现五卡前不要把四卡改写成最终契约，也不要提前拆掉 Capture / Outputs。
- Session rail **目标态**：五张不可折叠圆角卡 `Progress / Artifacts / Outputs / Context / Capture`。Artifacts 只投影 main-owned Investigation Artifacts；Outputs 仍只接受 `output_register`；Capture 保留。落地后直接收敛到五卡，禁止同时维持目标三卡 / 当前四卡 / 目标五卡三套文案。
- Context contains only concrete task-used attachments, files, directories, Skill sources, invoked MCP tools, and web references proven by frozen Prompt segments or successful tool results; generic tool categories and configured-but-unused entries are forbidden. Renderer must not parse args/result previews or rebuild these resources. Capture is always visible with an honest empty state when no input exists. Capture owns scoped `.rdc` selection, Replay Device, open, preview, refresh, copy, clear, and compact diagnostics. Do not restore Classic fallback, ArtifactTree, Working Directory, standalone Memory, per-tool `rd.*` inventory, CLI catalog summary, tool count, duplicate Skills catalog, or `session:outputs:list`.
- Outputs only show explicit user output files. `output_register` is the canonical agent action: it may copy only a completed file inside the active project into the owning run, and it must reject inputs and escaping paths. Do not pin `plan.md`; do not expose `artifact_store`, `run_report`, or `action_output` source names in UI contracts. Investigation Artifacts 不得混进 Outputs。
- Run `pnpm run check:right-rail` for UI/IPC changes. Browser QA must use the latest `start:agent-browser` bootstrap `/qa` surface, delete QA project sessions first, create isolated sessions, and cover empty state, real Tasks, Outputs, project import, RDX owner/diagnostic behavior, cross project/session gates, narrow drawer, Escape/focus return, Settings parity, and unknown-channel bridge denial. 五卡落地后同一套 QA 必须覆盖 Artifacts 空态 / 有内容 / 与 Outputs 分离。

## 修改时的检查项

- 是否存在只改 UI 没改 IPC 或共享类型的情况。
- 是否存在只改主进程没改渲染层入口或状态展示的情况。
- 是否引入新的重复定义、旧命名或兼容分支。
- 是否把运行期 / 构建期产物错误地带回仓库结构。
- 是否让现有 UI/UX 的布局、交互或视觉效果发生非预期退化。
- 是否需要同步更新 `README.md`、`docs/` 或注释中的说明。

## 验证建议

标签说明：
- **[AUTO]** — 可通过 `pnpm run ...` 或 `vitest` 在本地 / CI 自动执行，CI 已覆盖或应覆盖。
- **[MANUAL]** — 需人工判断、审查或确认，无对应自动化门禁。
- **[BROWSER-QA]** — 需通过 `pnpm run start:agent-browser` 浏览器真实会话验收，涉及视觉 / 交互 / 端到端行为。
- 一条规则可同时携带多个标签（如 `[AUTO] [BROWSER-QA]` 表示既有自动化检查又需浏览器视觉验收）。

---

- **[MANUAL]** 开始实现前先写明本次验证方式；实现后按该方式验证并报告结果。无法运行的验证，必须说明原因和剩余风险。
- **[AUTO]** `pnpm run test:coverage` 覆盖 node unit surface（`vitest.config.ts` 仅排除 Electron/OS 强绑定 glue；核心 runtime 计入覆盖率）；初始阈值 floor 见 `vitest.config.ts` thresholds，实测只升不降门禁见 `scripts/fidelity/coverage-ratchet.json` + `pnpm run check:coverage-ratchet`（当前基线约 lines 68.89 / functions 70.51 / branches 55.95 / statements 66.74）。集成面走 `check:contracts` + 浏览器真实会话；renderer 走 browser QA 与 `check:*`。
- **[AUTO]** 代码改动后执行 `pnpm run typecheck` 与 `pnpm run lint`（`no-unused-vars` / `exhaustive-deps` 为 error）。
- **[AUTO]** 依赖、入口、构建、发布配置或仓库目录治理改动后执行 `pnpm run check:repository-hygiene`。
- **[AUTO]** renderer 结构或 UI 锚点改动后执行 `pnpm run check:architecture`（含 Orchestrator façade &lt;800 与 `src/main` 单文件 ≤900）、`pnpm run check:fidelity`、`pnpm run check:shared-exports`。
- **[AUTO]** Orchestrator / debugger 编排拆分后执行 `pnpm run check:orchestrator-facade`（`AgentOrchestrator.ts` 少于 800 行；禁止恢复 `legacyGlobalMirror` / `getRdxRuntimeContext`）。
- **[AUTO] [BROWSER-QA]** Session 切换、IPC 投影、Composer draft 恢复、Stop/Rewrite 或多 session 并行 UI 改动后执行 `pnpm run check:session-projection`；Browser QA 须覆盖：新建/切换 session 无 composer 串台、后台 turn 不污染 active transcript/trace、Rewrite+立即 Stop 单调落停、Preparing Stop 干净撤销本 session 草稿；每次先删尽 QA project sessions 再新建隔离 session。
- **[MANUAL]** CI（`.github/workflows/ci.yml`）必须跑 hygiene / typecheck / lint / test / test:coverage / 全套关键 `check:*` / `check:contracts` / build；宣称完成不得只靠 commit message。
- **[AUTO]** 覆盖率阈值改动或相关门禁回归执行 `pnpm run test:coverage`。
- **[AUTO]** Work Process 投影、工具行文案/图标或 transcript UI 改动后执行 `pnpm run check:work-process`、`pnpm run check:work-process-tool-coverage`。完整验收 checklist 见 [`docs/ui/work-process-checklist.md`](docs/ui/work-process-checklist.md)。
- **[BROWSER-QA]** Appearance / chrome / compose accent 改动后执行 `pnpm run check:appearance`。完整验收 checklist（含 Provider/Composer 控件、Effort 滑杆）见 [`docs/ui/appearance-checklist.md`](docs/ui/appearance-checklist.md)。
- **[AUTO]** provider thinking 投递或 reasoning artifact 投影改动后执行 `pnpm run check:reasoning-delivery`。
- **[AUTO]** scoped resource、project instruction、prompt snapshot、skill、hook 或 memory policy 改动后，必须执行相应专项 contract check；缺少时应在同一改动中补齐。
- **[AUTO]** 安全 / 并发 / 取消 / 存储故障 / provider wire 契约改动后执行：`vitest run src/main/testing/contracts`（及被触及的既有单测，如 `bridgeSecurity`、`jsonl`、`TurnCoordinator`、`ProcessSupervisor`、`DebuggerRuntimePolicy`）。
- **[AUTO]** 入口、构建或窗口逻辑改动后，再补 `pnpm run build` 或等价打包检查。
- **[MANUAL]** 发布配置改动后执行 `pnpm run pack`，并确认 unpacked 产物不包含开发期包管理器、lockfile、launcher 和缓存状态。
- **[BROWSER-QA]** 浏览器真实会话使用 `pnpm run start:agent-browser`（或 `scripts/run-rdc-launcher.* --mode browser`），然后用 Codex 内置浏览器打开主进程输出的 **complete bootstrap `/qa?qaBootstrap=...`**（勿截断 token URL）。Work Process / tool 卡片 UI 验收前必须先停旧进程再重启以加载最新前后端，并删除该 QA project 下全部 session 后新建隔离 session，避免跨 session/project 串台与脏数据。涉及 Send/Stop/Edit-and-resend 或流式卡顿时额外验收：Preparing Stop 干净撤销、Running Stop 单调落停、Rewrite 提交即时切分支、流式期间窗口拖拽/滚动无明显整应用卡顿。
- **[MANUAL]** 人类开发入口使用 `pnpm run start:human:dev`，源码构建入口使用 `pnpm run start:human`；平台包装器只转发到共享 launcher，依赖与 build 由指纹条件式准备，发布模式直接双击 exe / app 包。
- **[AUTO]** Provider 体系契约验证使用 `pnpm run check:provider-system`。
- **[AUTO]** Provider Catalog strict manifest 与编译语义验证使用 `pnpm run check:provider-catalog`。Catalog schema、manifest 字段、identity 覆盖或 route/binding 改动后必须执行。Composer `/model` 与底栏 picker 必须共用 `isAgentToolExecutableModel` 可选集，禁止回读 `settings.agents.modelOptions`；该断言由内含的 `check:agent-tool-capability` 强制。
- **[AUTO] [BROWSER-QA]** Agent Loop / Tasks 改动必须覆盖相同指纹第二轮纠偏、第三轮终止、revision/result/args 变化复位、max-turn typed error、Ask Tasks 只读、Plan/Edit Tasks 可写、text-only route 不宣称工具、`tool_search` authoritative no-match；Browser 真实会话至少命中一次三轮无进展终止并确认没有 `CONVERSATION_LLM_REQUEST_FAILED`。
- **[BROWSER-QA]** Provider/model/control 改动先 fresh discovery，再对最终 selectable 集合逐模型发最小真实请求；按 `provider + protocol + adapter + reasoning mapping + context activation + fast binding + continuation` 去重深测。账户 denial 保持不可选，429 与明确 quota 的 402 记录短期 expiry，5xx 保持可恢复且不得伪装成功。容量来源必须区分 source-backed 与真实 activation，禁止伪称百万 token 满窗压测。
- **[AUTO]** HAL adapter 的 reasoning level 映射必须经 `ProviderReasoningMapper` 统一处理：manifest `reasoningEfforts` → wire effort 参数；新增 adapter 时确认 reasoning 投递路径经 `check:reasoning-delivery` 验证。
- **[AUTO]** Builtin 工具目录、manifest token 展开与 `REJECTED_TOOL_TOKENS` 契约验证使用 `pnpm run check:tool-system`（当前 39 ids，含 `shell` / `read_image` / `code_interpreter`；旧 token `bash` 硬拒）。
- **[AUTO] [BROWSER-QA]** `read_image` / `code_interpreter` / Tasks 快照 / Compact provenance 改动后执行 `check:tool-system`、`check:work-process`、`check:work-process-tool-coverage`、`check:right-rail`、`check:browser-capability`；Browser QA 覆盖 vision fail-closed、解释器产物缩略图、一轮一张活任务卡与 Right Rail 同序同态、手动 `/compact` 卡片。
- **[AUTO] [BROWSER-QA]** Composer 附件管道改动后执行 `check:shared-exports`、`check:browser-capability`、`check:fidelity`、`check:session-projection`、`check:right-rail`、`check:appearance`；Browser QA 覆盖空态、单图/多图、大文本、PDF、二进制、超限拒绝、`.rdc` 引导、vision 前置警告、移除、transcript 缩略图打开、Right Rail Context、Preparing Stop 回填、跨 session、390px 窄屏。
- **[AUTO]** Settings Agents 路由契约验证使用 `pnpm run check:settings-agents`。
- **[BROWSER-QA]** 产品级本地验收通过真实浏览器会话完成，并指向真实 project 和 `.rdc`；RDX/RenderDoc 失败必须 fail-closed 并显示诊断。
- **[BROWSER-QA]** 涉及工作台交互、页面结构、样式引用或共享契约的改动后，至少补一次关键 E2E smoke 或等价人工回归，确认主界面、关键面板和主要交互未退化。
- **[MANUAL]** 仅文档改动时，检查术语、路径和描述是否与当前仓库结构一致。
- **[AUTO]**（目标态 / 迁移中；ratchet 已建立、目标债务未清零）`pnpm run check:knowledge-system`：Knowledge 五服务单一事实源、七 lane 可用性、semantic `unavailable/stale` fail-closed、human-only 写入、ColdData 不自动 Candidate、脱敏 fixture、无自动 Promote。债务只减不增，Wave 6 清零；未来 `knowledgeSystemContract.test.ts` 一旦存在即由门禁硬执行，禁止 skip/todo/无断言空壳。
- **[AUTO]**（目标态 / 迁移中；ratchet 已建立、目标债务未清零）`pnpm run check:investigation-system`：垂直 schema 字段完整性（含 `claimId`/`experimentId`/`challengeId`/`artifactId`）、`ready` 需要结构化 `sourceRefs>=1`（`artifactId`+`expectedHash`）+ `contentHash` 对 `contentRef` + kind Registry + 正文 schema 通过、认识论偏序不可升级、`S-CAUSAL-01` 必须引用可解引用 Experiment 且 `intervention.type!=none`、`status ∈ {recorded, rolled_back}`、`rollback.executed===true` 且 `rollback.baselineRestored===true` 并存在 verify evidence、`S-CLAIM-01` 投影须带 `compactProvenance`、`S-RDC-01` mutate 隔离、不侵入 `TaskRecord`/`AgentProfile`/`ConversationMessage`。债务只减不增，Wave 6 清零；未来 `investigationSystemContract.test.ts` 一旦存在即由门禁硬执行，禁止 skip/todo/无断言空壳。
