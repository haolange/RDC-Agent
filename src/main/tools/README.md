# Tools

`src/main/tools` owns the main-process boundary for invoking system-installed RDX CLI commands.

The forward path is:

`UI/agent -> Settings shell action or bash -> ShellInvocationService -> system-installed CLI`

Rules:

- The CLI command, default arguments, working directory, environment, timeout, and catalog path come from Settings.
- No bundled RDX tool copy or repository resource fallback is allowed in this layer.
- Renderer and preload code may read catalog/runtime status through IPC, but they must not expose an arbitrary tool execution API.
- Tool traces are emitted from the invoker so Activity, workflow, and diagnostics observe the same execution boundary.
