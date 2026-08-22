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
| `EffectiveRuntimePlan` | `schemaVersion: 2`；one exact User/Project profile snapshot (provenance, skills, handoffs, enabled ids), tools/skill intersection, deferred/MCP lease, permission/policy/route/request+prompt fingerprints；Prompt and Executor share it |
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

`PromptPlan` 每段含 id、kind、scope、source path/hash、precedence、content、token estimate、`stable|volatile`。稳定前缀指纹锚定 prompt-cache。Session 重建路径：`conversation.jsonl` + `conversation-branches.json` + `session-context.jsonl`。

发送是 next-turn 事务：`preparing → committing → running → terminal`。Preflight 冻结 catalog/route/controls/`PromptPlan`/tools/attachments，并创建主进程 opaque credential lease。失败/取消的 preflight 不留 Session/journal/lease 残渣。

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

Builtin 目录以 `BUILTIN_AGENT_TOOL_IDS` 为准（39 ids，含 `read_image` / `code_interpreter`）。Manifest token 经 `CANONICAL_TOOL_TOKEN_EXPANSIONS` 展开（`read` 含 `read_file`+`read_image`，`interpreter`/`image` 为专用 token）；`REJECTED_TOOL_TOKENS` 拒绝无静默 fallback。

`read_image` 在 `visionInputMode !== 'native'` 时 `VISION_INPUT_UNSUPPORTED`。tool-result 图像由 `ContextManager.convertToLlm` 剥出并桥成紧随的 user image part；UI 缩略图只走 session `image-previews` + `conversation:getToolImagePreview`，禁止把大 base64 写入 `resultPreview`。`code_interpreter` 执行 Settings 配置的外部解释器，未启用 fail-closed。

`native-structured` 路由：core schema 常驻；extended / `mcp__*` deferred，经 `tool_search` 等契约路径激活。未激活调用 → `TOOL_NOT_ACTIVATED`。Tasks 工具按 Agent 角色过滤后预激活：Ask 仅 `task_list` / `task_get`，Plan/Edit 等具备 mutation 权限的 profile 才可获得 `task_create` / `task_update` / `task_stop`。

Prompt 仅依据 route 最终实际注入的工具生成能力说明。text-only route 的有效工具集为空，不得列出或模仿工具调用。`tool_search` 无结果时返回 `NO_MATCH_IN_EFFECTIVE_TOOL_SET`、`authoritative: true` 与工具集 fingerprint；fingerprint 未变化时重复同一搜索属于无进展。

执行前：`toolValidator.validate`；失败 → `TOOL_SCHEMA_VIOLATION`。`CompiledPolicy.deniedTools` 进入 Permission + Executor。非法 policy → fail-closed。

Temporary 外部路径只经当前 `ToolExecutionContext.temporaryAllowedPathRoots`，不得全局泄漏。

Slash 命令是 runtime 输入，不绕过 profile 权限。基线：`/help` `/compact` `/context` `/memory` `/agents` `/skills` `/mcp` `/status` `/model`。

权限模式：`Default` / `Auto-review` / `Full access` / `Custom(config.toml)`；主进程权威。即使 Full access：二进制/`.rdc` 拒绝进对话、realpath 约束、灾难性 shell 硬拒绝、`web_*` SSRF fail-closed、`bash run_in_background` 未闭环前禁用。

## Skills 工具收窄

见产品文 [`../product/scoped-runtime-resources.md`](../product/scoped-runtime-resources.md) 与 `DESIGN.md` Invariant：

```text
allowedTools = ∩(skill_i) ∩ runtimeAllowlist
```

空 `allowed-tools` 不收窄。实现：`intersectSkillAllowedTools` + `combineActiveSkillAllowlists`（`DebuggerRuntimePolicy`）。

## RDX / Capture

无内置 RDX toolchain。Open capture / remote / preview / close 只走 Settings shell action → `ShellInvocationService`。已打开 `.rdc` 由 `ownerSessionId` 拥有；不匹配 fail-closed。Local + Android-origin capture 不得静默 fallback remote。

RDX runtime context 仅绑定 per-session lease（`RdxRuntimeContextRegistry`）。禁止恢复 `legacyGlobalMirror` / `getRdxRuntimeContext` 全局 API；工具路径经 `assertRdxContextLeaseOwnership`。

## Model Capability（摘要）

`EffectiveCatalogService` 是唯一能力权威。Composer 跟已提交 Agent route revision，不跟乐观 Settings 投影。Context 计量相位：`Preparing` → `Current request ~` → `Actual` / idle `Last actual`。缩窗只在 send preflight 派生压缩视图。完整 UI 计量与控件语义见 `docs/ui/workbench-and-transcript.md`。

## 相关源码

- `src/main/workflow/debugger/` — Orchestrator façade、TurnCoordinator、DeferredTools
- `src/main/agent-runtime/EffectiveRuntimePlan.ts` — schemaVersion 2 冻结 plan
- `src/main/sessions/RdxRuntimeContextRegistry.ts` — per-session RDX lease
- `src/main/runtime/ProcessSupervisor.ts`、`src/main/lifecycle/ShutdownCoordinator.ts`
- `src/main/agent-runtime/` — prompt、providers、permissions、tools
- `src/main/conversation/` — Conversation、journal、Work Process 策略
- 门禁：`pnpm run check:orchestrator-facade`（挂于 `check:architecture`）
