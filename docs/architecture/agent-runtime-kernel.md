# Agent Runtime Kernel

The agent runtime owns agent turns, tool mediation policy, deterministic events, provider routing, approval events, and final run status.

## Boundaries

- Provider adapters format model requests and stream model responses. They do not decide product mode, workflow stage, approval state, tool policy, or final run status.
- Ask mode is read-only. It may use read/glob/grep/task list/web fetch/web search style tools, but it must not request shell, write, edit, remove, task mutation, or RenderDoc mutation.
- Debugger execution may use shell access through the runtime profile, but RDX-specific work is still mediated by `RdxCliInvokerService` and Settings.
- No RDC-specific bridge, MCP server, or skill registry is injected as a hidden default tool path.

## Tool Mediation

The execution path for RDX work is:

`AgentRuntime -> workflow/debugger service -> RdxCliInvokerService -> ShellInvocationService -> configured RDX CLI`

`ToolRegistry` continues to mediate runtime tool requests, but RDX CLI command configuration is not stored in the registry. It is stored in `settings.tooling.rdxCli`.

## Validation

- Static contract: `npm run typecheck`
- Architecture/fidelity/shared export checks after renderer or shared-contract changes
- Shell smoke after window, preload, IPC, workspace permission, or RDX CLI invocation boundary changes
