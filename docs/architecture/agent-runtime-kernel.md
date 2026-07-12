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

Readable `summary` or `raw` thinking is not inserted into ordinary composer context on later turns. Chat Completions compatible providers, Gemini, Ollama, DeepSeek/Qwen/Kimi/GLM-style `reasoning_content`, and other readable thinking streams use `replayPolicy: 'none'` unless the adapter has an explicit opaque continuation artifact. OpenAI Responses and Anthropic Messages may use `replayPolicy: 'provider-artifact'` only for their native replay item/block shape.

Work Process visibility follows provider intent without leaking hidden state: provider-visible summary thinking renders as a user-collapsible disclosure at the top of its `llm_turn`, raw provider-visible thinking is collapsed but user-expandable, and opaque provider state is retained only for runtime/provider continuity without plaintext UI. Assistant final-answer text streams only in the assistant message body and is not duplicated into Work Process as loop result text. Loops with thinking or tool evidence render a Work Process section; models without thinking support may still show a direct loop result when that result is attached to tool execution evidence.

After at least one visible process section exists, a later answer-only `llm_turn` does **not** project a Reply / final-response boundary row. Provider-visible closing thinking folds into a quiet thinking-only section; if that turn has no visible thinking, it produces no Work Process row. The final answer body streams only in the assistant message body as full-bleed prose and must not be copied into Work Process. Duplicate late summary thinking that was already shown in a preceding process section is suppressed.

## Validation

- Static contract: `npm run typecheck`
- Agent runtime contract: `npm run check:agent-runtime`
- Work Process contract: `npm run check:work-process` and `npm run check:work-process-tool-coverage`
- Architecture/fidelity/shared export checks after renderer or shared-contract changes
- Shell smoke after window, preload, IPC, workspace permission, or RDX CLI invocation boundary changes
