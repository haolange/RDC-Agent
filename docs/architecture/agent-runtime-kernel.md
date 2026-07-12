# Agent Runtime Kernel

> 本文描述当前 Agent Runtime 的稳定设计边界与可验证契约。产品边界与验证门禁以根目录 `DESIGN.md` 为 SSOT。

The agent runtime owns agent turns, tool mediation policy, deterministic events, provider routing, approval events, and final run status.

## Boundaries

- Provider adapters format model requests and stream model responses. They do not decide product mode, workflow stage, approval state, tool policy, or final run status.
- Agent route capability gates tool registration before each turn. Only `native-structured` routes receive tool schemas and enter the tool execution loop.
- Prompt composition lives in `src/main/agent-runtime/prompt`. Conversation code collects context, but does not hand-code provider/tool prompt fragments.
- Ask mode is read-only. It may use `read_file`, `glob`, `grep`, `task_list`, `tool_search`, `web_fetch`, and `web_search`, but it must not request shell, write, edit, remove, task mutation (`task_create` / `task_update` / `task_stop`), or RenderDoc mutation.
- Debugger, Analyzer, and Optimizer execution may use shell access through their runtime profiles. RDX-specific app entries are mediated by Settings shell actions and `ShellInvocationService`.
- No RDC-specific bridge, MCP server, or skill registry is injected as a hidden default tool path.
- Assistant text is never parsed as an executable tool call. Textual tool-call shaped output produces a diagnostic event only.

## Tool Mediation

The execution path for RDX work is:

```text
AgentRuntime or UI -> bash or Settings shell action -> ShellInvocationService -> system-installed RDX CLI -> RdxRuntimeContext
```

`ToolRegistry` continues to mediate runtime tool requests, but RDX CLI command configuration is not stored in the registry. Catalog/runtime summary configuration is stored in `settings.tooling.rdxCli`; open/connect/preview/close command recipes are stored in `settings.tooling.rdxActions`.

General agent tools are mediated by `AgentPermissionPolicy` before execution. The policy combines profile allowlists, permission mode, workspace root, configured readable/writable roots, command allow/deny lists, and tool metadata. Routine workspace inspection can run in `Default`; external files, mutation, network, destructive shell, and unrecognized commands emit approval or auto-review events. Temporary external path access is granted only for the approved tool call and is not a renderer-side bypass.

## Deferred MCP Tool Loading

`native-structured` 路由按两级注入工具 schema：builtin/workbench 工具全量注入；`mcp__*` 工具默认 deferred——保留在执行器 `toolMap` 中可执行，但不进入 provider tools 列表，发现入口为 `mcp` catalog 工具与 `tool_search`。激活途径有二：`tool_search` 结果命中 `mcp__*`（结果文本已含完整 schema），或模型直接调用未注入的 `mcp__*`（fail-open 执行并顺带激活）。激活集按 `session::agent` + 全量工具签名保存在 orchestrator（`partitionDeferredMcpTools`，`src/main/workflow/debugger/mcpDeferredTools.ts`），激活后经 `Agent.setTools` 原地更新共享 tools 引用，同 turn 内下一次 LLM 调用即携带新 schema；全量工具集合变化时激活集重置。`RequestEnvelopeSnapshot.tools` 始终反映实际发送集。契约由 `npm run check:tool-system` 静态校验。

## Provider Event Normalization

Provider-private protocols are normalized before reaching Conversation or Work Process:

- OpenAI-compatible streams map `tool_calls` into `tool.requested`.
- Anthropic-style streams map `tool_use` and `input_json_delta` into `tool.requested`.
- Gemini and Ollama map native function/tool call responses into the same event contract.
- Tool execution emits `tool.started` and `tool.completed` from the runtime, not from frontend inference.
- Unsupported route capability, textual tool calls, and empty no-tool responses emit `diagnostic` events.

Work Process renders these normalized events only. It must not infer reasoning, tools, or results from the assistant body.

## Reasoning Artifact Boundary

Runtime thinking is normalized into three separate layers:

- `Transcript`: ordinary user messages, assistant final text, tool calls, and tool results that may be replayed as normal model context.
- `WorkTrace`: UI progress data in `ConversationWorkTrace`. Each `llm_turn` contains optional `ThinkingArtifact`, a `thinkingStatus` lifecycle flag, a canonical `result`, and nested tool calls. While running, the Work Process header uses dynamic Active Signal copy such as `工作中`; after settle it is process-first (`工作过程 · 持续 ... · ... 个动作` / English `Work process`) rather than a terminal status headline. The normal Work Process UI renders process-backed loops with a fixed hierarchy: provider-visible thinking disclosure first as the loop's top transcript node, commentary markdown prose second, and flat or aggregated tool / approval / `ask_user` evidence third (no semantic step-group shell, no `toolGroup` nesting shell). Commentary must never be promoted into the thinking slot. Loop-level thinking labels do not reuse the header title: active `正在思考`, settled `已思考 · {duration}` / `Thought for {duration}` with a quiet leading spark icon (never `深度思考` or settled `思考了`). Desensitized Request Inspector remains code-level debug tooling only—not in the default Session/Trace right panels and not inside the Work Process transcript. The canonical `result` remains runtime data for lifecycle/accounting, but answer-body-only result text must not duplicate into the Work Process. `assistant.thinking_delta` updates thinking only; `assistant.thinking_end` only marks thinking complete; `assistant.delta` streams assistant answer text outside the Work Process unless that loop also has tool evidence.
- `ProviderReasoningArtifact`: protocol-native continuation payloads such as OpenAI Responses encrypted reasoning items or Anthropic thinking/signature/redacted blocks. These artifacts are replayed only by the matching provider adapter and are never converted into ordinary assistant text.

Readable `summary` or `raw` thinking is not inserted into ordinary composer context on later turns. Readable thinking uses `replayPolicy: 'none'` unless an adapter explicitly identifies provider-required continuation content. OpenAI-compatible `reasoning_content` may use `openai-reasoning-content`, and OpenAI Responses or Anthropic Messages may use `provider-artifact`, only when the producing `providerId + modelId + protocol` exactly match the next route. Agent/model/Fast route changes remove incompatible reasoning continuation state while preserving ordinary assistant text and paired tool facts.

## Canonical session context

Session history is agent-neutral and append-only. `conversation.jsonl` stores transcript messages, `conversation-branches.json` is the fork and active-leaf authority, and `session-context.jsonl` stores one provider-neutral terminal delta per turn. At request start, the shared branch resolver selects the active leaf's visible turn ids; the route materializer selects those journal entries, filters route-private artifacts, then combines them with the current `PromptPlan`, effective tools, route, and controls. Agent profiles and runtime slots are execution configuration/caches, not independent session truth.

Fast, Max context, reasoning effort, Agent, model, provider, and protocol changes apply to the next turn without proactively compacting or rewriting history. Compaction is a derived request view used only when the target window requires it; the canonical journal is never replaced by a summary. Missing visible turn entries, invalid journal records, incompatible migration state, or persistence failure fail closed.

Edit-and-resend and branch switches wait for the active turn to finish scheduler flush, provider abort, tool/Ask cleanup, terminal conversation persistence, journal append or error publication, and active-turn cleanup. A rewrite then writes one concrete branch with its actual user anchor and root turn before starting exactly one resend. Terminal entries use the branch, turn, and message identities captured at start; they never infer ownership from a later active leaf. Migration may synthesize provider-neutral entries from canonical conversation/branch data, but never reads old per-Agent thread files. A migration marker is committed only after all journal appends succeed, and partial runs resume idempotently.

Work Process visibility follows provider intent without leaking hidden state: provider-visible summary thinking renders as a user-collapsible disclosure at the top of its `llm_turn`, raw provider-visible thinking is collapsed but user-expandable, and opaque provider state is retained only for runtime/provider continuity without plaintext UI. Assistant final-answer text streams only in the assistant message body and is not duplicated into Work Process as loop result text. Loops with thinking or tool evidence render a Work Process section; models without thinking support may still show a direct loop result when that result is attached to tool execution evidence.

After at least one visible process section exists, a later answer-only `llm_turn` does **not** project a Reply / final-response boundary row. Provider-visible closing thinking folds into a quiet thinking-only section; if that turn has no visible thinking, it produces no Work Process row. The final answer body streams only in the assistant message body as full-bleed prose and must not be copied into Work Process. Duplicate late summary thinking that was already shown in a preceding process section is suppressed.

## Validation

- Static contract: `npm run typecheck`
- Agent runtime contract: `npm run check:agent-runtime`
- Work Process contract: `npm run check:work-process` and `npm run check:work-process-tool-coverage`
- Architecture/fidelity/shared export checks after renderer or shared-contract changes
- Shell smoke after window, preload, IPC, workspace permission, or RDX CLI invocation boundary changes
