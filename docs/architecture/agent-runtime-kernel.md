# Agent Runtime Kernel

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

`AgentRuntime or UI -> bash or Settings shell action -> ShellInvocationService -> system-installed RDX CLI -> RdxRuntimeContext`

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

## Validation

- Static contract: `npm run typecheck`
- Agent runtime contract: `npm run check:agent-runtime`
- Architecture/fidelity/shared export checks after renderer or shared-contract changes
- Shell smoke after window, preload, IPC, workspace permission, or RDX CLI invocation boundary changes
