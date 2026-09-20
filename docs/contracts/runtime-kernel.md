# Runtime Kernel 契约

> 产品边界与不变量以根目录 `DESIGN.md` 为 SSOT。本文是从 DESIGN 分拆出的 **Runtime / Prompt / Provider / Tool / Session** 稳定契约；实现细节见 `docs/architecture/agent-runtime-kernel.md` 与源码，二者冲突时以 `DESIGN.md` + 本文为准并修正架构文。

## Agent Loop

唯一运行时路径：

1. 解析 profile、model route、policy、可用工具；
2. 调用 LLM；
3. 执行已批准工具；
4. 将工具结果回灌 loop；
5. 产出 final answer。

`ConversationWorkTrace` 是可见进度契约。块类型包括：`llm_turn`、`reasoning`、`approval`、`user_input`、`compaction`、`subagent`、`handoff`、`diagnostic`、`output`。历史不匹配 canonical schema 的 `workTrace` 在存储读边界丢弃（`workTrace: null`），无 legacy 归一化。

每个工具回灌轮次必须经过 `LoopProgressGuard`。指纹包含有序工具名、规范化参数、成功/失败、语义结果与 runtime revision，忽略 call id、时间戳和耗时。连续第二次相同只向下一次请求注入不落盘的 `<runtime_no_progress>`；第三次仍相同抛出 `AgentLoopTerminationError('AGENT_NO_PROGRESS')`。参数、结果或 runtime revision 改变立即复位。达到 `maxTurns` 时若 Provider 仍要求 continuation，抛出 `AgentLoopTerminationError('AGENT_MAX_TURNS_EXCEEDED')`，禁止静默完成或伪造缺失 final answer。

Work Process 的工具摘要只由 runtime tool result 计算 `succeeded / failed / skipped`，不得采信模型自述。可恢复的中途失败仍保留可见证据，产品不能显示“全部成功”的合成结论。

## 关键编排模块（Phase 1–4）

| 模块 | 职责 |
| --- | --- |
| `EffectiveRuntimePlan` | `schemaVersion: 3`；project-aware effective profile snapshot（definition + scope/provenance/sourceHash + compiled route）+ 冻结 `profileDelegates`（effective `agents`）；tools/skill intersection, deferred/MCP lease, permission/policy/route/request+prompt fingerprints, attachment manifest fingerprint；Prompt and Executor share it。`settings.llm.agentRoutes` 只是 `compiledRoute` 的 Settings 派生镜像；`getEffectiveModel` / `applyLlmConfig` / preflight 只读 snapshot 的 `compiledRoute`。 |
| `AgentOrchestrator` | façade（少于 800 行）；`ProfileTurnPreparation` 为 sendMessage/sendProfileMessage/subagent 唯一 prepare 入口；无 `preparedRuntime` → `TURN_NOT_PREPARED` |
| `TurnCoordinator` / `TurnHandle` | Session ownership Active→Aborting→Orphaned→Settled；Orphaned 时 `beginTurn` → `TURN_ORPHANED`；`abortAndJoin` 等 stream + producerCompletion；late producer join |
| `ProcessSupervisor` | spawn/joinAll；POSIX pgid；Windows `taskkill /T`；close-observed registry；timeout yields `unconfirmed_orphan` |
| `ShutdownCoordinator` | `running → … → release_owned_runtimes → terminate_processes → … → exited`；before-quit 限时 `shutdownAll`；RDC clear+stop 不得与 `joinAll` 并行 |
| `AgentSlotRegistry` / `McpConnectionCoordinator` / `DeferredToolActivationTracker` / `TurnHandle.pendingHandoff` | Per-session/per-project ownership；AgentState 键 `scope::agentId`；MCP pool `realpath+projectId+descriptorHash`；orphan pool quarantine；transport 仅 stdio/streamable-http（sse fail-closed） |
| `RdcRuntimeContextRegistry` | 仅 per-session RDC context lease；无 global mirror |
| `LoopRuntimeState` | Agent 工具面 COW；每轮读 `runtime.current` |
| `LoopProgressGuard` | 检测相同工具轮次无进展；第二轮纠偏、第三轮 typed termination；runtime revision 变化即复位 |

Conversation 单一真相：turn 开始 `rehydrate(fromDisk)`；结束 flush 并清空 slot messages；分支切换 / rewrite 显式 `syncSessionSlots`。

## Prompt 与 Request

```text
Scoped Runtime Resolution
  -> EffectiveCatalogService
  -> PromptPlanBuilder
  -> Context / Message Transformation
  -> RequestEnvelopeBuilder
  -> RequestPlanner (closed RequestPlan)
  -> Provider Adapter
  -> Provider Wire Request
```

`PromptPlan` 每段含 id、kind、scope、source path/hash、precedence、content、token estimate、`stable|volatile`。稳定前缀指纹锚定 prompt-cache。Session 重建路径：`conversation.jsonl` + `conversation-branches.json` + `session-context.jsonl`。`context-view.json` 现写 `{ schemaVersion: '1', view }`；缺版本裸 view 走 `SESSION_CONTEXT_VIEW_MIGRATIONS`。`shell-state.json` 现写 `{ schemaVersion: '1', state: { cwd } }`，只存 cwd；缺版本或损坏 fail-closed / quarantine，未知更高版本 `STORAGE_SCHEMA_UNSUPPORTED`。

切模型不自动 compact、不写迁移事务。`ContinuationReplayPolicy` 按 compiled execution identity 决定同绑定回放 / 跨绑定 drop；普通 Send 与 rewrite 在将丢弃 continuation 制品时插入同一条系统通知。optional 制品保留最近 8 个可见 turn；`requirement: required` 制品不受该窗口过期，只随 compaction 边界终止。

仅自动压缩；产品不提供按钮、菜单、`/compact` 或 `/summary`。会话准备和执行途中复用同一条 LLM 结构化 handoff：`PromptPlan → RequestEnvelope → adapter`，单轮、无工具、禁用 cache write，`StructuredHandoff.derivation = 'model-generated'`。LLM 失败显式报错，不静默回退确定性抽取。低于压缩线原样继续且不生成压缩工作块。首条超大输入先完整外置并核验，不调用摘要模型，也不静默删减。

发送是 next-turn 事务：`preparing → committing → running → terminal`。Preflight 冻结 catalog/route/controls/`PromptPlan`/tools/attachments，并创建主进程 opaque credential lease。失败/取消的 preflight 不留 Session/journal/lease 残渣。Composer 附件先经 `conversation:stageAttachments` 写入 `{userData}/state/staging/attachments/`（进程启动清空）；turn commit 才拷进 session `attachments/`。`ConversationAttachmentMaterializer` 按 image / text / pdf / binary 四层物化：image 走 native vision；text/pdf 按 `min(固定上限, contextBudgetTokens * ratio)` 均分后 inline，prepare 冻结最终 session 逻辑路径与正文，run 只补 image 字节；binary 只给元数据。扫描件 PDF 无文本层写诊断；加载失败 / 加密不伪装成扫描件。SVG 硬拒。

用户 Stop 按相位分流：`preparing` → 干净撤销（Composer 恢复发送前草稿，transcript 不保留本轮）；`committing` / `running` → 单调落停（assistant/`workTrace` 进入 `stopped`，禁止再被迟到 `streaming` patch 或 optimistic 回滚打回运行中/发送前）。Main `ActiveConversationTurn.stop()` 落盘 pending 时不得再向 renderer emit `streaming`；权威终态由 `commitStoppedMessage` / terminal event 给出。Edit and resend 提交后 renderer 立即 optimistic 切入新 branch variant，IPC 返回后 reconcile。多 session 并行时 renderer 投影与 Composer 恢复规则见 [`session-projection.md`](session-projection.md)。

## Provider Reasoning 与输出通道

语义值：`raw` | `summary` | `opaque` | `none` | `unknown`。声明缺失保持 `unknown`，禁止静默升级。

每个 wire block 先获得稳定 `ProviderOutputRef`；首次语义声明永久归属 `thinking` | `text` | `tool_call` 之一。kind collision、start 前 delta、close 后 delta、terminal 后语义事件 → fail-closed。禁止按文本相同做跨通道去重。

仅显式 thinking block 可创建 `ThinkingArtifact`；普通 assistant text 永不合成 thinking。仅 `outputPhase='commentary'` 写 Work Process commentary；仅 `final_answer` 写正文与 final trace。正常结束但无 canonical final → fail-closed。

## Provider 错误模型契约

`src/shared/types/providerErrors.ts` 定义统一错误分类：

```typescript
type ProviderErrorCode =
  | 'provider_unknown' | 'auth_unconfigured' | 'auth_expired'
  | 'auth_scope_denied' | 'model_source' | 'request_rejected' | 'rate_limit'
  | 'quota_exceeded' | 'network' | 'timeout'
  | 'context_overflow' | 'stream_protocol' | 'aborted' | 'unknown';

interface ProviderErrorInfo {
  code: ProviderErrorCode;
  retryable: boolean;
  httpStatus?: number;
  message: string;
  details?: Record<string, unknown>;
}
```

**Retryable 分类**：`rate_limit`、`network`、`timeout` 始终可重试；`stream_protocol` 视具体模式（“stream ended without message_stop”“you can retry your request” 可重试，其余不可）；其余均不可重试。

分类器（`errorClassifier.ts`）为纯函数，无副作用；优先级：Abort → HTTP status → 消息模式 → 流协议 → fallback `unknown`。

## 诊断契约（Diagnostics）

`AssistantMessage.diagnostics` 在流失败时附加诊断条目：

```typescript
interface AssistantMessageDiagnostic {
  type: string;              // 诊断类型标识
  timestamp: number;         // Unix 毫秒时间戳
  error?: {
    name?: string;
    message: string;
    stack?: string;
    code?: string | number;  // HTTP status 或业务码
  };
  details?: Record<string, unknown>;  // 结构化补充信息
}
```

`isRetryableAssistantError(message)` 遍历 `diagnostics` 并对每个 `error` 调用 `classifyProviderError`，任一 retryable 则整条消息可重试。诊断信息不进入 IPC / renderer / Trace，仅供主进程重试决策与脱敏日志使用。

Agent loop 终止与 Provider 失败互斥：`AGENT_NO_PROGRESS` → `CONVERSATION_AGENT_LOOP_STALLED`；`AGENT_MAX_TURNS_EXCEEDED` → `CONVERSATION_AGENT_TURN_LIMIT_EXCEEDED`；`PROVIDER_STREAM_*` → `CONVERSATION_PROVIDER_STREAM_PROTOCOL_VIOLATION`。只有真实网络、鉴权、配额或 wire 故障才产生 `CONVERSATION_LLM_REQUEST_FAILED`。

## Tools 与 Permission（执行侧）

Builtin 目录以 `BUILTIN_AGENT_TOOL_IDS` 为准（49 ids，含 `shell` / `read_image` / `code_interpreter` / `artifact_read` / `rdc_probe`、五个 deferred `knowledge_*` 与三个 deferred `investigation_*`）。Manifest token 经 `CANONICAL_TOOL_TOKEN_EXPANSIONS` 展开（`read` 含 `read_file`+`read_image`+`artifact_read`，`knowledge` 含五个 Knowledge 工具，`investigation` 含三个 Investigation 工具，`interpreter`/`image`/`shell` 为专用 token）；`REJECTED_TOOL_TOKENS` 拒绝无静默 fallback（含旧 token `bash`）。

`read_image` 在 `visionInputMode !== 'native'` 时 `VISION_INPUT_UNSUPPORTED`。tool-result 图像由 `ContextManager.convertToLlm` 剥出并桥成紧随的 user image part；UI 缩略图只走 session `image-previews` + `conversation:getToolImagePreview`，禁止把大 base64 写入 `resultPreview`。`code_interpreter` 执行 Settings 配置的外部解释器，未启用 fail-closed。

`native-structured` 路由：core schema 常驻；extended / `mcp__*` deferred，经 `tool_search` 等契约路径激活。未激活调用 → `TOOL_NOT_ACTIVATED`。Tasks 工具只在冻结 allowlist 含对应 token 时预激活，不再按 Ask/Plan/Edit 角色硬编码。

Run **当前实现**唯一活跃 `schemaVersion` 为 `'3'`（`src/main/sessions/runV3/`）：discriminated union `kind: conversation|mission` + `profileId`，新写无 `mode` / `lastStage` / `runtime.workflow_stage`。v0–v2 在 session-scoped `.run-v3-migration.lock` 内 archive-and-rewrite 到 `migration-backups/run-v3/<runId>/<sha256>.<json|yaml>`，**不得**对 v2/v3 双读。只有精确三 Mission profile 才是 `kind: mission`；conversation 的 `captures=[]` 且不消费 investigation sidecar。无法分类的历史 run 只能成为带迁移诊断的 `kind: conversation`，**绝不从旧 stage 推断 Mission**。归档不是 active fallback，不进入 Run 枚举、IPC、UI 或 Right Rail。见 `DESIGN.md` 裁决 I。

Prompt 仅依据 route 最终实际注入的工具生成能力说明。text-only route 的有效工具集为空，不得列出或模仿工具调用。`tool_search` 无结果时返回 `NO_MATCH_IN_EFFECTIVE_TOOL_SET`、`authoritative: true` 与工具集 fingerprint；fingerprint 未变化时重复同一搜索属于无进展。

执行前：`toolValidator.validate`；失败 → `TOOL_SCHEMA_VIOLATION`。`CompiledPolicy.deniedTools` 进入 Permission + Executor。非法 policy → fail-closed。

同轮工具并发：只有 `AgentTool.spec.isConcurrencySafe === true` 才安全，缺省 `false`。`ConcurrentToolScheduler` 只并发**连续**安全组；`shell` / write / task mutation / RDC（含 `rdc_probe`） / MCP / ask / handoff / `output_register` 与需要 RDC lease 的 `subagent` 一律串行。offline `subagent` 不请求 `domainExtensions.rdc`，且 **在 allowlist 层**就不能拿到 `rdc_context` / `rdc_probe` / `shell` 中的 RDC 路径。`domainExtensions.rdc.requiresLease=true` 的 child 必须经显式、受限、生命周期绑定的 delegated lease 取得 parent 上下文并串行。禁止并发 RDC 双 owner。`callIndex` 稳定回填。`reserveDispatchBudget` 在 dispatch 前原子扣减 `maxToolCalls` / `maxSubagents` / wall clock；失败整组不开。组内部分失败不连坐已发出调用，但不得继续开新组。abort 必须 `Promise.allSettled` join。

`subagent` 只接受有界 Delegation Capsule：goal/task/scope、带 sourceRefs/qualification 的 acceptedFacts、hypotheses、challengeRefs、带理由/适用/重验条件的 negativePaths、inputArtifactRefs、outputRequirements、stopConditions、requiredSkillIds 和 budget；可选 domainExtensions 仅申请能力。缺字段、超限或非法引用 fail-closed。compiler 只向 system PromptPlan 加入 runtime 编写的解释规则，完整 Capsule 数据进入隔离子执行的 user 输入，不复制父历史。必需 Skill 在 prepareTurn 预载并冻结。

Temporary 外部路径只经当前 `ToolExecutionContext.temporaryAllowedPathRoots`，不得全局泄漏。

Slash 命令是 runtime 输入，不绕过 profile 权限。基线：`/help` `/context` `/memory` `/agents` `/skills` `/mcp` `/status` `/model`。`/model` 参数为 `[provider:model|modelId|default]`；`default` 跟随当前 Agent 配置，与 Composer 底栏共用 EffectiveCatalog + `isAgentToolExecutableModel` 可选集。裸 `default` 先于模型 id 解析，真名叫 `default` 的模型用 canonical `provider:model`。

权限模式：`Default` / `Auto-review` / `Full access` / `Custom(config.toml)`；主进程权威。即使 Full access：二进制/`.rdc` 拒绝进对话、realpath 约束、灾难性 shell 硬拒绝（按平台分集）、`web_*` SSRF fail-closed。agent `shell` 每次新进程，不提供 `run_in_background`。

## Skills 工具收窄

见产品文 [`../product/scoped-runtime-resources.md`](../product/scoped-runtime-resources.md) 与 `DESIGN.md` Invariant：

```text
allowedTools = ∩(skill_i) ∩ runtimeAllowlist
```

空 `allowed-tools` 不收窄。实现：`intersectSkillAllowedTools` + `combineActiveSkillAllowlists`（`DebuggerRuntimePolicy`）。

## Hooks

唯一引擎是 `HookEngine`。分发根：`resources/agent-runtime/hooks`（builtin）< `~/.rdc-agent/hooks` < `<project>/.rdc-agent/hooks`，与 `ScopedResourceResolver` 同序。Hook trust fingerprint = parsed definition + 所有 resolved 脚本/参数文件 bytes + canonical realpath + scope/provenance + PATH 解析后的 executable identity；任一变化 → `needsRetrust`。builtin 默认信任且内容变化必须随仓库发布；user/project 必须显式 trust。旧仅-YAML-hash trust 在首次加载时失效并要求 retrust（不静默沿用）。接线事件（12 canonical）：`session.before-start` / `session.after-end`、`turn.before-start` / `turn.after-end`、`tool.before-call` / `tool.after-call` / `tool.on-error`、`context.before-compact` / `context.after-compact`、`agent.before-handoff` / `agent.after-handoff`、`permission.denied`。禁止第二套 `AgentHooks`。

## Declared Continue and Execution Offer

`AgentHandoffDefinition` 只是 Copilot 式 UI 声明（label / agent / prompt / send / showContinueOn / requiredSkillIds）。人点建议行或计划门后，主进程 `applyDeclaredHandoff` 校验选项属于当前（或刚批准的）profile，触发 `agent.before-handoff` / `agent.after-handoff`，写入 `<sessionPath>/execution-offer.json`，并 persist `session.agentId`。不存在 `agent_handoff` 工具，也不存在 `prepared → committed → consumed` 状态机。打开会话时若仍有 `handoff-state.json`，只 unlink，不 parse、不迁移。

计划门是另一条人机停顿：`plan_artifact` 写活计划并挂起，`approval.requested kind=plan_review`；拒绝意见回同一 tool result，批准写入 `TurnHandle.approvedPlan`（`approvedHash` + target + frozenUri）并覆盖 execution offer。回合成功终态把冻结 `profileHandoffs`（`showContinueOn !== false`）快照到 assistant `handoffSuggestions`。Mission 仅在本回合 workTrace 含真实已批准 `plan_artifact` 时才快照 Execute；General 无声明即无按钮。

`send: true` 只表示点完后预填并自动发送。失败提示并留草稿，迟到结果不得写进别的 session。手动改 Composer Agent pill 不写 offer、不预载调查 Skill。prepareTurn 仅当本回合 `agentId === targetAgentId` 且 session 批准计划与 offer 同 hash 时，把声明 `requiredSkillIds` 并入 PromptPlan preload。`handoff` / `agent` / `agent_handoff` token 拒绝。

## RDC / Capture

无内置 RDC toolchain。Settings `tooling.rdcCli` 必须配对同安装捆绑 Python 与 `cli/run_cli.py`。General 的 `shell.rdc`、主进程固定 open/remote/close 生命周期及 Live RDC mutate 经原生调用边界直接执行冻结 Python argv，并校验 exclusive lease；`shell.command` 不得调用 RDC，UI 不恢复旧 shell action 或 human-preview 入口。Mission planner 禁止 `shell` 与 `code_interpreter`，只通过受控只读 `rdc_probe` + `rdc_context` 访问 RDC（见 `DESIGN.md` 裁决 J）；probe 同样使用已验证绑定。仓库不硬编码本机安装路径。已打开 `.rdc` 由 `ownerSessionId` 拥有，不匹配 fail-closed；Local + Android-origin capture 不得静默 fallback remote。

RDC runtime context 仅绑定 per-session lease（`RdcRuntimeContextRegistry`）。禁止恢复 `legacyGlobalMirror` / `getRdcRuntimeContext` 全局 API；工具路径经 `assertRdcContextLeaseOwnership`，不得回退 parent。parent 经 `grantDelegatedLease` 授予 child 一条 scoped、生命周期绑定的 delegated lease；child 结束经实际停止确认后 `revokeDelegatedLease`；未确认时父资源保持隔离。未请求 `domainExtensions.rdc` 的 child 在 allowlist 编译期不得看到 `rdc_context` / `rdc_probe`。

## Model Capability（摘要）

`EffectiveCatalogService` 是唯一能力权威。Composer 跟已提交 Agent route revision，不跟乐观 Settings 投影。Agent/Composer 可执行模型必须通过共享 `isAgentToolExecutableModel` gate（source-backed `toolCalling.supported` + 已实现 structured-tool adapter + 账户 available）；`unknown`/`unsupported` 只留在 Settings catalog。Context 计量相位：`Preparing` → `Current request ~` → `Actual` / idle `Last actual`。缩窗在执行拥有的首次或后续安全请求边界安装派生窗口，准备阶段只测量权威历史。完整 UI 计量与控件语义见 `docs/ui/workbench-and-transcript.md`。

## 相关源码

- `src/main/workflow/debugger/` — Orchestrator façade、TurnCoordinator、DeferredTools
- `src/main/agent-runtime/EffectiveRuntimePlan.ts` — schemaVersion 3 冻结 plan
- `src/main/sessions/RdcRuntimeContextRegistry.ts` — per-session RDC lease
- `src/main/runtime/ProcessSupervisor.ts`、`src/main/lifecycle/ShutdownCoordinator.ts`
- `src/main/agent-runtime/` — prompt、providers、permissions、tools
- `src/main/conversation/` — Conversation、journal、Work Process 策略
- 门禁：`pnpm run check:orchestrator-facade`（挂于 `check:architecture`）


## 通用 Harness 与声明续跑（2026-09-15）

General 为默认通用工作身份。核心正文只负责可信上下文、授权、持续执行、Skill 发现与收口；领域名称可留在能力目录。renderdoc-investigation 按调查目标选择 Mission，普通术语问答不强制路由。Mission 策略采用 renderdoc-execution 的六块 Markdown 模板，按规模填写；Knowledge 相似性仅是检查线索。

Plan 经 session artifact plans 类别版本化：同意前覆盖 `session://plans/plan.md`，同意后冻结 `plan-<ISO>-<hash8>.md`，历史文件不迁移或删除。批准写入 execution offer；prepareTurn 仅当 hash 与 target 匹配时预载声明 Skill。通用 turn 仅调用 TurnCompletionValidator。Big Loop 由 General 终答写缺口、用户切回 Mission、新计划、再批准、再点 Execute 组成；runtime 不按身份 / depth / 正文开下一轮。 Mission 额度耗尽但未完成时可通过 `budget_paused` 结束 turn，绝不提升领域报告状态。

普通 Capsule 省略领域扩展且没有 RDC Lease prompt 段；仅 RDC 模块接受 domainExtensions.rdc.requiresLease=true 并注入租约上下文。缺省无 RDC；同一 live context 的租约独占覆盖完整子执行区间，其他安全工作仍可并行；finally 撤销须携带停止证明，否则隔离父资源；旧顶层字段拒绝，不保留双轨。


### Harness / 领域与上下文边界（2026-09-09 收敛）

通用完成检查不按 Mission/General 身份或 depth 推断 Big Loop。handoff Hook 只在人点声明续跑时触发。Checkpoint 与实验回执内容校验在领域服务。completed 才断言领域完成，且仅 Mission 可宣告；partial/blocked/cancelled 不提升报告。自然语言前缀不控制终态。

子执行 artifact_read 只读取显式授予且 hash 冻结的同一所属 Session 引用，嵌套委派取子集。子执行调查输出保存到原调查，输入引用的读权限不授予覆盖权限；只能更新本子执行新建的输出。退出撤销临时访问权，已保存产物继续归原 Session 所有。

Compact 使用原始 Journal、Task/执行记录及应用层组装的领域记录，不由通用 compactor 猜测调查步骤。压缩前保存可按行读取的分块 JSON 权威 Checkpoint，模型只看到有界权威记录与原始文本；不逐条截去长消息尾部。保存失败、hash 复核失败或原始输入超过安全界限时保留原 view，禁止静默丢失。原始图像/测量产物按 URI/hash 保留，摘要须保留来源资格、适用条件和反证的重验条件。

RDC delegated lease 暂停父控制权，父级 rebind/clear/close 必须先 join；原生结果不确定时隔离匹配版本，迟到失败不得隔离新版本。CLI 进程未观察 close 继续跟踪，相关 context 恢复受阻；观察实际 close 后可进入原有 capture close/open 验证并重新 prepareTurn。重开只恢复绑定，不证明实验 rollback。


### Task 执行、消息与资源生命周期

单一 TaskStore 的 canonical 文件为 `task-state.json`（仅当前 schema）。Task 保存目标、依赖、父任务、完成要求、修订与执行关联；TaskExecution 独立保存 executionId、taskRevision、generation、父执行、运行状态、共享预算快照、结果及可选冻结计划引用。取消或修订不会让旧结果覆盖新实例。不存在全局唯一 in_progress 限制；依赖存在、无环、已满足，以及完成要求的输出键与执行终态由 TaskRegistry 校验。要求覆盖是否完整、科学结论是否成立仍由模型及领域证据合同负责。

旧格式不由 TaskStore 自动迁移。转换须先逐文件备份原字节与 hash，再验证当前文档、依赖和状态后安装 `task-state.json` 并移除被替代的活动文件；历史完成状态不伪造执行证明。正常运行只有当前格式，无法读取时明确拒绝。runtimeInstanceId 变化使未结束执行转 interrupted；持久化恢复不自动启动模型、工具或重置预算。显式重试/恢复创建新执行，并继承限制与已消费预算。

subagent（mode=background） 必须绑定 Task，持久化启动状态后返回执行标识。query/result 读取状态与结果；wait/join 等待既有执行；message 提交有限补充；cancel 和 task_stop 取消执行树并 join。父回复可以结束而 Task 继续托管；父 Task 正式完成检查子任务、阻塞、失败及结果。用户 Stop、会话删除和应用退出清理运行树；未观察进程退出不能声明清理完成。

后台 subagent 的生命周期由持久 Task 与 mailbox 投影，不进入父回复的同步 subagent continuation，也不由父回复 finalizeTrace 提前结束；审批/信息请求仍走受控入口。结构化 turn_complete 的 disposition、evidenceRefs 位于顶层，result 包含 summary、outputs、counterevidence、unresolved、scope、sideEffects、recoveryState。unresolved 表达认识与适用条件，不自动成为 missingRequirements；完成要求仍由 Task 的必需输出及执行状态校验，不能由通用 runtime 推测科学结论。

TaskRootBudget 是同一 TaskStore 中的持久预算记录，以 execution.rootBudgetId 关联，不是第二个执行器或独立预算存储。直接执行、同步与后台子执行、handoff 共用根账本；Capsule 的局部上限及已消费量另存当前执行，派发、重试与恢复只收窄局部上限，不把 child 上限写成 root 上限。同步与后台均恢复本执行局部计数，并在工具效果前等待预算预留持久化；保存失败不得执行效果。parent 回复结束后，后台事件续跑沿用同一 live root ledger，不能创建零消费账本。

同一 root 的首次并发绑定串行提交，旧持久消费与新上下文独立消费只合并一次；后续绑定同一 live ledger 不重复计费。root 的计数不下降、cap 不增加、deadline 不延后。已经绑定 root A 的 live ledger 再请求不同 root B 时显式拒绝 TASK_ROOT_BUDGET_REBIND_DENIED，保留 A/B 与观察者归属，须由独立执行上下文处理，不能静默换绑。已有执行的重试继续使用原 rootBudgetId，不允许借新父轮次脱离旧预算。

handoff Task 的取消所有权从 durable prepared 实例转交 receiving turn。已 consumed 但接收者尚未登记的空隙内，取消保留 cancelling 并拒绝宣称清理完成；接收者登记时读取此取消意图，在首个 Provider 请求或工具效果前 abort/join。同一接收 turn 内 task_stop 或 task_update(cancelled) 只请求停止，避免等待自身；最终取消记录在 producer 与所属进程退出确认之后提交。

消息存入同一 TaskStore，绑定 taskId/executionId/generation/sequence，区分 to_parent/to_child。有效进展、阻塞、决策请求和结果经安全请求边界消费；游标去重，失效代次不能推进现任务。消息是有来源的数据，不改变冻结 PromptPlan 或授权。UI 事件不等于模型通知；不建立固定频率父模型轮询。审批继续使用现有受控入口，消息不继承审批。

资源仲裁按真实项目路径（含符号链接/junction 解析）或所属 Session 锁定。安全读可共享，unsafe 工具和 Hook 外部效果互斥；审批在工具效果锁之前。调度/等待工具以内部 orchestration 元数据绕开它们所等待的子执行效果锁，实际子工具仍各自仲裁。ProcessSupervisor 的 unconfirmed_orphan 结果只表示有界等待结束，资源锁与原进程记录继续保留到真实 close/error。按执行会话查询/等待进程退出供 Task 取消收口使用；隔离资源阻止新效果，无关资源不受阻。

Small/Big Loop、Scout/Skeptic 委派和补证方向由实际加载的 Skill 与模型决定。runtime 不根据 Agent 名称、depth、正文前缀或关键词启动下一轮。root 两轮 execute/return 预算是硬上限，不是自动循环次数。


子执行的审批/信息请求在主进程绑定 ownerSessionId 与真实 child turn/request/execution 标识。父会话只投影待响应控件，答案仍进入原子请求服务并一次性消费；其他会话、缺失所有者和重复响应拒绝。后台请求可更新已结束父回复的 Work Process，不撤回正文或自动重开父模型。历史读取将进程重启后已无 pending 记录的子请求标为中断/取消，不能复活旧审批权限。

显式 artifact_read 图像在 native vision 路由返回标准 image block 与原 URI/hash；非视觉路由明确拒绝，不用省略提示冒充已审图。该显式读回不会再被大结果外置器换回引用，仍受原生请求预算及产物大小限制。子执行的大工具结果（包括错误）写回已登记根 Session，使用执行隔离路径并登记精确只读引用；长文本以可逆 JSON chunks 分页保存。引用文件 hash 与历史 envelope payload hash 依既有 resolver 合同区分，旧产物仍可读取。

项目根不能证明 shell/MCP 的副作用彼此隔离。unsafe effects 与 Hook effects 除 canonical 项目/会话排他区间外，共享一个保守串行区间；安全只读工作可并行。未观察进程退出时两个区间均保留，无关安全读不被该全局 unsafe 区间阻塞。


### 材料读取与委派参数的实际可用性

`artifact_read` 返回最多 16 KiB UTF-8 文本及同一 URI/hash 的 `next.offset`（行）和 `next.column`（UTF-16 列）游标；按原序拼接页体可重建超长单行和分块 JSON，不拆开 Unicode 字符。已受控分页的结果不再次外置成包装产物。原始图片单项上限 32 MiB，文本产物仍为 2 MiB，会话配额仍为 96 MiB；超限明确失败，不以缩略图替换原图。

Capsule 的 `profile` 是 Agent 身份，`model` 是 `providerId:modelId`，可选 `reasoningLevel` 经现有 Provider 请求规划校验；不能以推理强度充当身份。`sourceRefs`、`challengeRefs`、`inputArtifactRefs` 都只接受已有受控 URI；自然语言质疑属于 hypotheses/negativePaths。工具搜索按关键词排序，仅在已经过滤的有效工具集中发现；无匹配只证明当前筛选无匹配，不证明能力整体不存在。

压缩先验证原始来源，再持久保存候选，检查取消后原子安装窗口，安装后才发布 after-compact。此前 Provider response ID 不进入新窗口，以免 stateful adapter 绕过可移植续做状态；后续新响应仍可按已验证路由正常续接。签名/加密 reasoning 不进入可读摘要，原始用户历史不删除。原始文本与权威状态无法放入专用调用安全预算时暂停并保留原内容；未声称无限长度或无损压缩。


Task 的 completionRequirements 是 result.outputs 的精确键；验收语义写入描述，由模型依据证据判断，runtime 不猜测领域结论。委派时从所属 Task 存储读取这些键，与 Capsule 一起传入隔离子输入；调用方不能用另一个 Capsule 隐去必需交付。turn_complete 在记录声明前返回可修正的合同错误，最终 Task settlement 仍重复验证当前代次、依赖及结果完整性。完整返回与结构化输出先持久化并校验，再发送有界父投影和引用；子代理不需要另一个文件写入工具完成 runtime 自管的结果保存。

后台重试先选择已有 Task 的根预算，再绑定新执行；不先绑定新父轮预算后尝试换根。旧执行、消费与期限保留。自动压缩、角色恢复和 Provider 元数据刷新不重置这些状态。Composer 的推理选择按实际 Provider/模型路由恢复，同一路由下恢复 Agent 身份不应套用模型默认档位。

Task 状态文件的提交保持同一候选文件与原子 rename。短暂 EPERM/EBUSY 在持有存储锁期间最多重试三次（10/20/40 ms）；不删除目标、不重复领域操作。持续失败删除未安装候选、保留权威旧文件并返回原错误，不能宣称结果已持久保存。

计划批准先验证正文并冻结制品、持久化决策，再发布 TurnHandle 执行授权与 answered 事件；失败不发布批准，新审阅撤销旧在途授权。根/子计划审阅均不得同时生成普通工具审批；子请求回答与读取按持久 delegated owner 路由。

## 专用工具路由与读取前置

文件路由表独立于灾难 shellHardDeny 表，均在权限模式和自定义允许前缀之前求值；Full access 不能绕过。有效工具集合有对应工具时，shell.command 文件读写/搜索返回 SHELL_FILE_TOOL_BYPASS，命令行 RDC 返回 RDC_VIA_COMMAND_DENIED。edit_file 和覆盖已有文件的 write_file 必须先在同一 session 成功 read_file 同一 realpath，否则 READ_BEFORE_EDIT_REQUIRED。已读状态跨 turn、仅内存持有，重启须重读；子 session 不继承。新建文件免先读。

Agent 只绑定同安装捆绑 python.exe 的绝对路径与 cli/run_cli.py；旧 bat 和 PowerShell 转发返回 RDC_BAT_REJECTED，不迁移、不 fallback。旧配置仍可打开修正，但不能执行。
