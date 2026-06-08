# Workflow

`src/main/workflow/debugger/DebuggerRuntime.ts` is the public workflow facade for Debugger actions such as start, plan retrieval, question submission, approval, restart, stop, and state projection.

`DebugWorkflowService.ts` remains an internal execution service. IPC, conversation, preload, and renderer code must enter through the runtime facade or the registered IPC handlers, not through ad hoc service calls.

Execution constraints:

- Do not change workflow stage semantics without updating shared types, renderer state, and architecture docs together.
- Do not auto-wire Analyzer or Optimizer into the Debugger harness.
- RenderDoc tool execution goes through the configured RDX CLI invoker in `src/main/tools`.
- Do not restore manual stage advancement, rollback, or specialist-dispatch public bypasses.
