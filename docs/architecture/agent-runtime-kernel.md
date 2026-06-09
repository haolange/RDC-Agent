# Agent Runtime Kernel

The agent runtime owns agent turns, tool mediation policy, deterministic events, provider routing, approval events, and final run status.

## Boundaries

- Provider adapters format model requests and stream model responses. They do not decide product mode, workflow stage, approval state, tool policy, or final run status.
- Ask mode is read-only. It may use read/glob/grep/task list/web fetch/web search style tools, but it must not request shell, write, edit, remove, task mutation, or RenderDoc mutation.
- Debugger, Analyzer, and Optimizer execution may use shell access through their runtime profiles. RDX-specific app entries are mediated by Settings shell actions and `ShellInvocationService`.
- No RDC-specific bridge, MCP server, or skill registry is injected as a hidden default tool path.

## Tool Mediation

The execution path for RDX work is:

`AgentRuntime or UI -> bash or Settings shell action -> ShellInvocationService -> system-installed RDX CLI -> RdxRuntimeContext`

`ToolRegistry` continues to mediate runtime tool requests, but RDX CLI command configuration is not stored in the registry. Catalog/runtime summary configuration is stored in `settings.tooling.rdxCli`; open/connect/preview/close command recipes are stored in `settings.tooling.rdxActions`.

## Validation

- Static contract: `npm run typecheck`
- Architecture/fidelity/shared export checks after renderer or shared-contract changes
- Shell smoke after window, preload, IPC, workspace permission, or RDX CLI invocation boundary changes
