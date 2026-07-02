# Agent Runtime Kernel

> 接线状态声明：本文档描述 agent runtime 的设计边界与契约，不把当前接线进度当成事实来源。长生命周期 Agent、ContextManager 压缩、ErrorRecovery、Memory、Subagent/Handoff 等真实接线进度，以 [`agent-runtime-completion-plan.md`](./agent-runtime-completion-plan.md) 为权威来源。

The agent runtime owns agent turns, tool mediation policy, deterministic events, provider routing, approval events, and final run status.

## Boundaries

- Provider adapters format model requests and stream model responses. They do not decide product mode, workflow stage, approval state, tool policy, or final run status.
- Agent route capability gates tool registration before each turn. Only `native-structured` routes receive tool schemas and enter the tool execution loop.
- Prompt composition lives in `src/main/agent-runtime/prompt`. Conversation code collects context, but does not hand-code provider/tool prompt fragments.
- Ask mode is read-only. It may use read/glob/grep/task list/web fetch/web search style tools, but it must not request shell, write, edit, remove, task mutation, or RenderDoc mutation.
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
- `WorkTrace`: UI progress data in `ConversationWorkTrace`. Each `llm_turn` contains optional `ThinkingArtifact`, a `thinkingStatus` lifecycle flag, a canonical `result`, and nested tool calls. UI order is thinking disclosure first, loop result second, tool execution rows third. `assistant.thinking_delta` updates thinking only; `assistant.thinking_end` only marks thinking complete; `assistant.delta` streams the loop result.
- `ProviderReasoningArtifact`: protocol-native continuation payloads such as OpenAI Responses encrypted reasoning items or Anthropic thinking/signature/redacted blocks. These artifacts are replayed only by the matching provider adapter and are never converted into ordinary assistant text.

Readable `summary` or `raw` thinking is not inserted into ordinary composer context on later turns. Chat Completions compatible providers, Gemini, Ollama, DeepSeek/Qwen/Kimi/GLM-style `reasoning_content`, and other readable thinking streams use `replayPolicy: 'none'` unless the adapter has an explicit opaque continuation artifact. OpenAI Responses and Anthropic Messages may use `replayPolicy: 'provider-artifact'` only for their native replay item/block shape.

Work Process visibility follows provider intent without leaking hidden state: summary thinking may open while streaming and folds after completion; raw provider-visible thinking is collapsed by default and user-expandable; opaque provider state renders only as retained-state status. Models without thinking support do not render a thinking row and stream the loop result directly.

## Validation

- Static contract: `npm run typecheck`
- Agent runtime contract: `npm run check:agent-runtime`
- Work Process contract: `npm run check:work-process` and `npm run check:work-process-tool-coverage`
- Architecture/fidelity/shared export checks after renderer or shared-contract changes
- Shell smoke after window, preload, IPC, workspace permission, or RDX CLI invocation boundary changes