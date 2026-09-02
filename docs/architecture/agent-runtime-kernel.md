# Agent Runtime Kernel

> 契约权威：[`docs/contracts/runtime-kernel.md`](../contracts/runtime-kernel.md) 与根目录 `DESIGN.md`。本文保留实现向边界与模块说明；冲突时先改 contracts / DESIGN，再同步本文。

The agent runtime owns agent turns, tool mediation policy, deterministic events, provider routing, approval events, and final run status.

## Boundaries

- Provider adapters format model requests and stream model responses. They do not decide product mode, workflow stage, approval state, tool policy, or final run status.
- Agent route capability gates tool registration before each turn. Only `native-structured` routes receive tool schemas and enter the tool execution loop.
- Prompt composition lives in `src/main/agent-runtime/prompt`. Conversation code collects context, but does not hand-code provider/tool prompt fragments.
- Tool capability comes only from the effective profile manifest ∩ active skill ∩ policy ∩ runtime prerequisites. Empty tools fail-closed (`AGENT_TOOLS_EMPTY`). There is no Ask-readonly / Plan→Edit / custom→Edit hardcoded fallback. General is the Execution Orchestrator; Debugger / Analyzer / Optimizer are Planning Orchestrators. User-retained ask/plan/edit manifests remain custom profiles.
- Mission profiles (`debugger` / `analyzer` / `optimizer`) are plan-only: they must not receive `shell` or `code_interpreter`. They access RDX only through controlled read-only `rdx_probe` plus `rdx_context` (current session lease status). General executes lease-holding Live RDC operations through Settings-configured shell actions and `shell`. RDX-specific app entries are mediated by Settings shell actions and `ShellInvocationService`. See `DESIGN.md` adjudication J.
- No RDC-specific bridge, MCP server, or skill registry is injected as a hidden default tool path.
- Assistant text is never parsed as an executable tool call. Textual tool-call shaped output produces a diagnostic event only.

## Tool Mediation

The execution path for RDX work is:

```text
Mission planner -> rdx_probe / rdx_context (read-only Settings actions) -> ShellInvocationService -> system-installed RDX CLI
General or UI -> shell or Settings shell action (lease-holding Live RDC) -> ShellInvocationService -> system-installed RDX CLI -> RdxRuntimeContext
```

`ToolRegistry` continues to mediate runtime tool requests, but RDX CLI command configuration is not stored in the registry. Catalog/runtime summary configuration is stored in `settings.tooling.rdxCli`; openCapture / openRemoteCapture / connect / preview / close command recipes are stored in `settings.tooling.rdxActions`.

General agent tools are mediated by `AgentPermissionPolicy` before execution. The policy combines profile allowlists, permission mode, workspace root, configured readable/writable roots, command allow/deny lists, and tool metadata. Routine workspace inspection can run in `Default`; external files, mutation, network, destructive shell, and unrecognized commands emit approval or auto-review events. Temporary external path access is granted only for the approved tool call and is not a renderer-side bypass.

## Deferred Tool Loading（core/extended 分层）

`native-structured` 路由按 tier 注入工具 schema：`BUILTIN_AGENT_TOOL_TIERS` 中的 core builtin 每请求常驻注入且顺序稳定（保 prompt cache 前缀）；extended builtin 与 `mcp__*` 工具默认 deferred——保留在执行器 `toolMap` 中可执行，但不进入 provider tools 列表，发现入口为 `tool_search`（只搜索 allowlist + runtime policy 过滤后的工具集）与 `mcp` catalog 工具。只有 `tool_search` 命中可激活 deferred 工具；直接调用未激活 deferred 工具 fail-closed 返回 `TOOL_NOT_ACTIVATED`。Tasks 是显式例外：冻结计划预激活其已获准的 Tasks 工具；是否可写只看 effective manifest ∩ skill ∩ policy，不再按 Ask/Plan/Edit 角色硬编码。激活集按 `session::agent` + 全量工具签名保存在 orchestrator（`partitionDeferredTools`，`src/main/workflow/debugger/deferredTools.ts`），激活后经 `Agent.setTools` 原地更新共享 tools 引用，激活 schema 按激活顺序追加在 core 前缀之后，同 turn 内下一次 LLM 调用即携带；全量工具集合变化时激活集重置。`RequestEnvelopeSnapshot.tools` 始终反映实际发送集；context breakdown 以 `mcp_tools_deferred` / `builtin_tools_deferred` 报告未激活估算量。契约由 `pnpm run check:tool-system` 静态校验。

`tool_search` 对最终 effective tool set 做权威搜索。空结果返回结构化 `NO_MATCH_IN_EFFECTIVE_TOOL_SET`、`authoritative: true` 和 tool-set fingerprint；同一 fingerprint 下重复相同搜索不能得到新工具。text-only route 在 `PromptPlanBuilder` 中得到空工具集，Prompt 明确禁止把 tool-call-shaped 文本当作调用，也禁止反复搜索本轮不存在的工具。

## Loop Progress 与终止

`LoopProgressGuard` 在每次工具结果回灌后构建稳定指纹：有序工具名、规范化参数、成功/失败、语义结果和 `LoopRuntimeState.revision`；call id、时间戳与耗时不参与。第二个连续相同指纹只为下一次 LLM 请求追加一次易失 `<runtime_no_progress>` 指令，第三次仍相同抛出 `AGENT_NO_PROGRESS`。任一参数、结果或 revision 变化都复位计数。

Agent 达到 `maxTurns` 时，只有已经获得 canonical final 才能正常完成；若 Provider 仍要求 continuation，则抛出 `AGENT_MAX_TURNS_EXCEEDED`。Conversation 分别映射为 `CONVERSATION_AGENT_LOOP_STALLED` 与 `CONVERSATION_AGENT_TURN_LIMIT_EXCEEDED`；流式协议完整性违规映射为 `CONVERSATION_PROVIDER_STREAM_PROTOCOL_VIOLATION`。三者都和 `CONVERSATION_LLM_REQUEST_FAILED` 互斥。Work Process 的完成摘要由真实 tool result 统计成功、失败、跳过，模型自述不能覆盖 runtime 证据。

## Provider Event Normalization

Provider-private protocols are normalized before reaching Conversation or Work Process:

- OpenAI-compatible streams map `tool_calls` into `tool.requested`.
- Anthropic-style streams map `tool_use` and `input_json_delta` into `tool.requested`.
- Gemini and Ollama map native function/tool call responses into the same event contract.
- GitLab Duo and SAP AI Core use the shared AI SDK streaming bridge only after a dedicated adapter has resolved their native authentication and route. The bridge verifies the frozen `RequestPlan.effectiveModelId`, forwards its closed wire patch, and normalizes text, reasoning, tool calls, usage, abort, and terminal state without re-reading Settings.
- Tool execution emits `tool.started` and `tool.completed` from the runtime, not from frontend inference.
- Work Process result summaries are reduced from those runtime completions; a recoverable tool failure remains visible and cannot be rewritten into an all-success product status by assistant prose.
- Route capability diagnostics use structured `code + severity + message + surface`: unverified native tools are runtime-log-only `info`, explicit unsupported is a Work Process `warning`, and unavailable/disabled routes are Work Process `error`. Textual tool calls and empty no-tool responses remain diagnostics, never executable tool evidence.

Work Process renders these normalized events only. It must not infer reasoning, tools, or results from the assistant body.
Each adapter assigns a stable `ProviderOutputRef` before a provider block enters the runtime. The ref must carry the provider's own block identity: protocol-supplied indexes or item ids when present, otherwise consecutive same-kind deltas share one ref and a kind switch closes that segment. An ordered typed slot registry owns the block lifecycle: one source ref can be claimed once as `thinking`, `text`, or `tool_call`, then accepts only same-kind deltas until close. Reusing a closed ref, emitting a delta before start or after close, changing an Anthropic content-index type, or emitting semantic events after the provider terminal marker raises `PROVIDER_STREAM_CHANNEL_COLLISION` / `PROVIDER_STREAM_BLOCK_CLOSED` or the corresponding structured protocol diagnostic and terminates the provider step. OpenAI-compatible virtual thinking, text, and tool slots use separate namespaces. Distinct provider refs are never merged or hidden because their text happens to match.

## Reasoning Artifact Boundary

Runtime thinking is normalized into three separate layers:

- `Transcript`: ordinary user messages, assistant final text, tool calls, and tool results that may be replayed as normal model context.
- `WorkTrace`: UI progress data in `ConversationWorkTrace`. Each `llm_turn` contains optional `ThinkingArtifact`, a `thinkingStatus` lifecycle flag, a canonical `result`, and nested tool calls. While running, the Work Process header uses dynamic Active Signal copy such as `工作中`; after settle it is process-first (`工作过程 · 持续 ... · ... 个动作` / English `Work process`) rather than a terminal status headline. The normal Work Process UI renders process-backed loops with a fixed hierarchy: provider-visible thinking disclosure first as the loop's top transcript node, commentary markdown prose second, and flat or aggregated tool / approval / `ask_user` evidence third (no semantic step-group shell, no `toolGroup` nesting shell). Commentary must never be promoted into the thinking slot. Loop-level thinking labels do not reuse the header title: active `正在思考`, settled `已思考 · {duration}` / `Thought for {duration}` with a quiet leading spark icon (never `深度思考` or settled `思考了`). Desensitized request snapshots remain storage/IPC only for a future dedicated Debug View—not in Settings Diagnostics, not in the default Session/Trace right panels, and not inside the Work Process transcript. The canonical `result` remains runtime data for lifecycle/accounting, but answer-body-only result text must not duplicate into the Work Process. `assistant.thinking_delta` updates thinking only; `assistant.thinking_end` only marks thinking complete; `assistant.delta` streams assistant answer text outside the Work Process unless that loop also has tool evidence.
- `ProviderContinuationArtifact`: protocol-native continuation payloads such as OpenAI Responses encrypted reasoning items or Anthropic thinking/signature/redacted blocks. Replay is decided by the compiled `ExecutionIdentity` and continuation contract; incompatible artifacts are dropped fail-closed and are never converted into ordinary assistant text.
`ProviderReasoningContract` is a strict route-manifest fact carried unchanged through `EffectiveModel -> RequestPlan -> AgentRouteCapability`. No provider-id list, endpoint table, or protocol-name heuristic may classify readable thinking. Ordinary assistant text never creates a `ThinkingArtifact`; Trace synthesis and session reload read only explicit thinking blocks.

Turn output is reduced by typed phase rather than text shape. `commentary` is optional Work Process prose, while `final_answer` is the sole writer of the canonical assistant body and final trace node. Normal provider completion without a canonical final answer fails closed. Commentary, thinking, and final may contain identical bytes when they came from different explicit source refs; the runtime preserves those typed facts and performs no string or similarity deduplication.

Readable `summary` or `raw` thinking is not inserted into ordinary composer context on later turns. Readable thinking uses `replayPolicy: 'none'` unless an adapter explicitly identifies provider-required continuation content. OpenAI-compatible `reasoning_content` may use `openai-reasoning-content`, and OpenAI Responses or Anthropic Messages may use `provider-artifact`, only when the producing `providerId + modelId + protocol` exactly match the next route. Agent/model/Fast route changes remove incompatible reasoning continuation state while preserving ordinary assistant text and paired tool facts. DeepSeek thinking-mode routes that send tools declare `artifactScope: all-assistant-turns` so later user turns replay `reasoning_content` (empty string when no artifact exists). Optional continuation artifacts expire after 8 visible turns; `requirement: required` artifacts are not retention-expired and only end at a compaction boundary. Switching models does not compact or rewrite history; ordinary Send and rewrite both insert the same continuation-drop system notice when execution identity changes and artifacts will be dropped.

## Canonical session context

Session history is agent-neutral and append-only. `conversation.jsonl` stores transcript messages, `conversation-branches.json` is the fork and active-leaf authority, and `session-context.jsonl` stores one provider-neutral terminal delta per turn. At request start, the shared branch resolver selects the active leaf's visible turn ids; the route materializer selects those journal entries, filters route-private artifacts, then combines them with the current `PromptPlan`, effective tools, route, and controls. Agent profiles and runtime slots are execution configuration/caches, not independent session truth.

Fast, Max mode, reasoning effort, Agent, model, provider, and protocol changes are immediate local next-turn state and never proactively estimate, compact, or rewrite history. Before send, `ConversationTurnCoordinator` flushes the latest Agent/Provider commit, refreshes credentials and entitlement, freezes the exact catalog/model/route/variant/controls, resolves tools/skills/attachments, and builds the `PromptPlan`, `RequestEnvelope`, and closed `RequestPlan`. It also acquires an opaque main-process credential lease that freezes the selected provider configuration and resolved short-lived credentials without placing secrets in IPC, renderer state, persisted turn summaries, journals, or traces. Token estimation, compaction and fit checks run only during this Preparing phase in a bounded worker. Every committed turn owns that frozen plan and lease, so later asynchronous changes can affect only the next send.

Preparing is persistence-free. Cancellation or failure before commit restores the Composer snapshot and leaves no Session, Turn, branch, attachment, journal, transcript, draft, or credential lease. A successful preflight atomically commits the turn and `requestId` mapping before provider execution; retries with the same request id resolve to that committed turn rather than creating a duplicate. The running adapter reads only the frozen lease; terminal, cancellation, and exceptional paths all release it. New sessions use a staged directory rename, while existing sessions use a per-session lock and recoverable journal. Provider-native reasoning artifacts replay only for an exact `providerId + effectiveModelId + protocol + routeRevision` match.

Settings Agent 编辑走 scoped revisioned Agent mutation service；provider/model-route 偏好走等价的 per-provider coordinator。保存结果是 `committed`、`superseded` 或 `failed`，带 commit hash 和 last successful snapshot，原子替换一份规范资源，并只刷新受影响的 Agent 或 route。它不重建 workspace、不重初始化 IPC、不重载整份 LLM settings、不广播全部 provider catalog、也不改写历史 turn。Renderer 选择是乐观的，只有最新失败 revision 可以回滚。`.agent.md` 是 Agent-route 的唯一持久真值；settings 只暴露只读投影。Composer 底栏与 `/model` 选择当前对话模型，并共用同一套 EffectiveCatalog 可执行集合：有 session 写 `modelOverride`，无 session 只记草稿并随首次发送冻结；未 override 是显式可选状态（「按 Agent 配置」/ `/model default`），清除写 `null` 或清草稿；Agent route 不可执行时禁止清除；不写回 `.agent.md`，切 Agent 不清模型。

Edit-and-resend and branch switches wait for the active turn to finish scheduler flush, provider abort, tool/Ask cleanup, terminal conversation persistence, journal append or error publication, and active-turn cleanup. A rewrite then writes one concrete branch with its actual user anchor and root turn before starting exactly one resend. Rewrite binds the **current Composer** `selectedAgentId` plus the current conversation model, and builds the same `configurationCommit` as Send (flush agent + flush provider + catalog revision + routeRevision). The rewritten turn is excluded from replay via `excludeTurnId`. When `crossModel` is `provider-managed`, an effective-model change must disconnect continuation (no leftover `previous_interaction_id` or equivalent). Ordinary Send and rewrite both insert the same transcript system hint when reasoning continuation is dropped. Session compaction — manual `/compact` and occupancy-triggered auto-compact — generates one model-authored `StructuredHandoff` (`derivation: 'model-generated'`) through `PromptPlan → RequestEnvelope → adapter`, with cache write disabled. There is no deterministic-extractive builder and no silent fallback. A request below the compaction line returns `status: 'noop'` and does not write a completed compaction work block. The architecture does not add model-switch migration transactions, portable work state, or workspace checkpoints. Terminal entries use the branch, turn, and message identities captured at start; they never infer ownership from a later active leaf. Migration may synthesize provider-neutral entries from canonical conversation/branch data, but never reads old per-Agent thread files. A migration marker is committed only after all journal appends succeed, and partial runs resume idempotently.

Work Process visibility follows provider intent without leaking hidden state: provider-visible `summary`, `raw`, and `unknown` thinking—including final-answer / closing sections—render as a user-collapsible disclosure at the top of their `llm_turn`, default-expanded while that loop is active and default-collapsed after settle (manual toggle sticky-overrides per section); opaque provider state is retained only for runtime/provider continuity without plaintext UI. Assistant final-answer text streams only in the assistant message body and is not duplicated into Work Process as loop result text. Loops with thinking or tool evidence render a Work Process section; models without thinking support may still show a direct loop result when that result is attached to tool execution evidence.

Tool disclosure aggregation is loop-local and consecutive-only: one through seven tool cards stay flat; the eighth consecutive tool creates one natural-language aggregate disclosure whose expanded children remain the existing single-layer tool cards. Commentary, thinking/loop boundaries, approval, `ask_user`, and diagnostic evidence cut the run; aggregation must never recreate a `toolGroup`, nested shell, or per-turn outer disclosure.

Agent/Composer executable models require source-backed `toolCalling.state === 'supported'` plus an implemented structured-tool adapter. `unknown` and `unsupported` stay out of the picker; persisted overrides fail closed with same-provider verified alternatives. The first adapter-produced `toolcall_end` on a native-structured route whose catalog evidence is not yet `supported` is deterministic positive evidence. Runtime records `toolCalling: supported` against the current provider/account/protocol/canonical model and publishes a new EffectiveCatalog snapshot at most once for the active run. An explicit provider rejection of `tools` records short-lived, revocable `unsupported` evidence. Text shaped like a tool call, 5xx, network, and quota failures do not qualify.

After at least one visible process section exists, a later answer-only `llm_turn` does **not** project a Reply / final-response boundary row. Provider-visible closing thinking folds into a quiet thinking-only section; if that turn has no visible thinking, it produces no Work Process row. The final answer body streams only in the assistant message body as full-bleed prose and must not be copied into Work Process. Duplicate late summary thinking that was already shown in a preceding process section is suppressed.

## Validation

- Static contract: `pnpm run typecheck`
- Agent runtime contract: `pnpm run check:agent-runtime`
- Work Process contract: `pnpm run check:work-process` and `pnpm run check:work-process-tool-coverage`
- Architecture/fidelity/shared export checks after renderer or shared-contract changes
- Shell smoke after window, preload, IPC, workspace permission, or RDX CLI invocation boundary changes
