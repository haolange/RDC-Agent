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
| `ShutdownCoordinator` | `running → … → exited`；before-quit 限时 `shutdownAll` |
| `AgentSlotRegistry` / `McpConnectionCoordinator` / `DeferredToolActivationTracker` / `TurnHandle.pendingHandoff` | Per-session/per-project ownership；AgentState 键 `scope::agentId`；MCP pool `realpath+projectId+descriptorHash`；orphan pool quarantine；transport 仅 stdio/streamable-http（sse fail-closed） |
| `RdxRuntimeContextRegistry` | 仅 per-session RDX context lease；无 global mirror |
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

manual `/compact` 与预算触发 auto-compact 共用同一条 LLM 结构化 handoff：`PromptPlan → RequestEnvelope → adapter`，单轮、无工具、禁用 cache write，`StructuredHandoff.derivation = 'model-generated'`。LLM 失败显式报错，不静默回退确定性抽取。低于压缩线返回 `status: 'noop'`，不得写 `complete` 压缩工作块。

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
  | 'auth_scope_denied' | 'model_source' | 'rate_limit'
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

Builtin 目录以 `BUILTIN_AGENT_TOOL_IDS` 为准（48 ids，含 `shell` / `read_image` / `code_interpreter` / `artifact_read`、五个 deferred `knowledge_*` 与三个 deferred `investigation_*`）。Manifest token 经 `CANONICAL_TOOL_TOKEN_EXPANSIONS` 展开（`read` 含 `read_file`+`read_image`+`artifact_read`，`knowledge` 含五个 Knowledge 工具，`investigation` 含三个 Investigation 工具，`interpreter`/`image`/`shell` 为专用 token）；`REJECTED_TOOL_TOKENS` 拒绝无静默 fallback（含旧 token `bash`）。

`read_image` 在 `visionInputMode !== 'native'` 时 `VISION_INPUT_UNSUPPORTED`。tool-result 图像由 `ContextManager.convertToLlm` 剥出并桥成紧随的 user image part；UI 缩略图只走 session `image-previews` + `conversation:getToolImagePreview`，禁止把大 base64 写入 `resultPreview`。`code_interpreter` 执行 Settings 配置的外部解释器，未启用 fail-closed。

`native-structured` 路由：core schema 常驻；extended / `mcp__*` deferred，经 `tool_search` 等契约路径激活。未激活调用 → `TOOL_NOT_ACTIVATED`。Tasks 工具只在冻结 allowlist 含对应 token 时预激活，不再按 Ask/Plan/Edit 角色硬编码。

Run 持久化是 v2 discriminated union：`kind: conversation|mission` + `profileId`，新写无 `mode`。只有精确三 Mission profile 才是 `kind: mission`；conversation 的 `captures=[]` 且不消费 investigation sidecar。旧 run 先原子归档再迁移；归档不是 active fallback。

Prompt 仅依据 route 最终实际注入的工具生成能力说明。text-only route 的有效工具集为空，不得列出或模仿工具调用。`tool_search` 无结果时返回 `NO_MATCH_IN_EFFECTIVE_TOOL_SET`、`authoritative: true` 与工具集 fingerprint；fingerprint 未变化时重复同一搜索属于无进展。

执行前：`toolValidator.validate`；失败 → `TOOL_SCHEMA_VIOLATION`。`CompiledPolicy.deniedTools` 进入 Permission + Executor。非法 policy → fail-closed。

同轮工具并发：只有 `AgentTool.spec.isConcurrencySafe === true` 才安全，缺省 `false`。`ConcurrentToolScheduler` 只并发**连续**安全组；`shell` / write / task mutation / RDX / MCP / ask / handoff / `output_register` 与需要 RDX lease 的 `subagent` 一律串行。offline `subagent` 必须 `requiresRdxLease=false`。`callIndex` 稳定回填。`reserveDispatchBudget` 在 dispatch 前原子扣减 `maxToolCalls` / `maxSubagents` / wall clock；失败整组不开。组内部分失败不连坐已发出调用，但不得继续开新组。abort 必须 `Promise.allSettled` join。

`subagent` 只接受 Delegation Capsule（`mission` / `task` / `acceptedFacts` / `forbiddenPaths` / `inputArtifactRefs` / `outputRequirements` / `budget` / `requiresRdxLease`）。缺字段 fail-closed。capsule 编译器产出 `delegation-capsule` PromptPlan 分段并注入子 Prompt。

Temporary 外部路径只经当前 `ToolExecutionContext.temporaryAllowedPathRoots`，不得全局泄漏。

Slash 命令是 runtime 输入，不绕过 profile 权限。基线：`/help` `/compact` `/context` `/memory` `/agents` `/skills` `/mcp` `/status` `/model`。`/model` 参数为 `[provider:model|modelId|default]`；`default` 跟随当前 Agent 配置，与 Composer 底栏共用 EffectiveCatalog + `isAgentToolExecutableModel` 可选集。裸 `default` 先于模型 id 解析，真名叫 `default` 的模型用 canonical `provider:model`。

权限模式：`Default` / `Auto-review` / `Full access` / `Custom(config.toml)`；主进程权威。即使 Full access：二进制/`.rdc` 拒绝进对话、realpath 约束、灾难性 shell 硬拒绝（按平台分集）、`web_*` SSRF fail-closed。agent `shell` 每次新进程，不提供 `run_in_background`。

## Skills 工具收窄

见产品文 [`../product/scoped-runtime-resources.md`](../product/scoped-runtime-resources.md) 与 `DESIGN.md` Invariant：

```text
allowedTools = ∩(skill_i) ∩ runtimeAllowlist
```

空 `allowed-tools` 不收窄。实现：`intersectSkillAllowedTools` + `combineActiveSkillAllowlists`（`DebuggerRuntimePolicy`）。

## Hooks

唯一引擎是 `HookEngine`。分发根：`resources/agent-runtime/hooks`（builtin）< `~/.rdx/hooks` < `<project>/.rdx/hooks`，与 `ScopedResourceResolver` 同序。Project hook 按内容 hash 授信。接线事件：`session.before-start` / `session.after-end`、`turn.before-start` / `turn.after-end`、`tool.before-call` / `tool.after-call` / `tool.on-error`、`context.before-compact` / `context.after-compact`、`agent.before-handoff` / `agent.after-handoff`、`permission.denied`。禁止第二套 `AgentHooks`。

## RDX / Capture

无内置 RDX toolchain。Open capture / remote / preview / close 只走 Settings shell action → `ShellInvocationService`。已打开 `.rdc` 由 `ownerSessionId` 拥有；不匹配 fail-closed。Local + Android-origin capture 不得静默 fallback remote。

RDX runtime context 仅绑定 per-session lease（`RdxRuntimeContextRegistry`）。禁止恢复 `legacyGlobalMirror` / `getRdxRuntimeContext` 全局 API；工具路径经 `assertRdxContextLeaseOwnership`。

## Model Capability（摘要）

`EffectiveCatalogService` 是唯一能力权威。Composer 跟已提交 Agent route revision，不跟乐观 Settings 投影。Agent/Composer 可执行模型必须通过共享 `isAgentToolExecutableModel` gate（source-backed `toolCalling.supported` + 已实现 structured-tool adapter + 账户 available）；`unknown`/`unsupported` 只留在 Settings catalog。Context 计量相位：`Preparing` → `Current request ~` → `Actual` / idle `Last actual`。缩窗只在 send preflight 派生压缩视图。完整 UI 计量与控件语义见 `docs/ui/workbench-and-transcript.md`。

## 相关源码

- `src/main/workflow/debugger/` — Orchestrator façade、TurnCoordinator、DeferredTools
- `src/main/agent-runtime/EffectiveRuntimePlan.ts` — schemaVersion 3 冻结 plan
- `src/main/sessions/RdxRuntimeContextRegistry.ts` — per-session RDX lease
- `src/main/runtime/ProcessSupervisor.ts`、`src/main/lifecycle/ShutdownCoordinator.ts`
- `src/main/agent-runtime/` — prompt、providers、permissions、tools
- `src/main/conversation/` — Conversation、journal、Work Process 策略
- 门禁：`pnpm run check:orchestrator-facade`（挂于 `check:architecture`）
