# Data Flow

This document describes the current cross-layer flow for project state, Debugger execution, Agentic Trace projection, and RDX CLI invocation.

## Debugger Execution

```mermaid
sequenceDiagram
  participant UI as Renderer
  participant API as Preload API
  participant IPC as Main IPC
  participant WF as DebuggerRuntime
  participant Invoker as RdxCliInvokerService
  participant Shell as ShellInvocationService
  participant CLI as Configured RDX CLI

  UI->>API: workflow:start / approve / stop
  API->>IPC: workflow:*
  IPC->>WF: runtime facade
  WF->>Invoker: call or executeCLI
  Invoker->>Shell: spawn configured command
  Shell->>CLI: command + args
  CLI-->>Shell: stdout / stderr / exit code
  Shell-->>Invoker: CLIResult
  Invoker-->>WF: ToolCallResult
  WF-->>IPC: workflow state
  IPC-->>UI: projection events
```

The invoker is fail-closed. If Settings do not enable and configure the command, calls return an explicit error rather than falling back to any repository path.

## Trace Projection

```mermaid
sequenceDiagram
  participant WF as Workflow
  participant Trace as TraceService
  participant Store as TraceStateStore
  participant IPC as trace IPC
  participant UI as AgentRunView / TraceRightPanel

  WF->>Trace: publish projection
  Trace->>Store: read branch and plan state
  Trace-->>IPC: trace:projectionChanged
  UI->>IPC: trace:getProjection / switchBranch / exportSession
  IPC-->>UI: AgentRunPresentation
```

`TraceService` builds the renderer-facing `AgentRunPresentation`. Right-panel records use `traceLaneId` and live in `src/shared/types/trace.ts`.

## Settings Flow

Settings are persisted by `SettingsService`, sanitized before write, and exposed to renderer through the existing settings IPC. RDX CLI settings live under `settings.tooling.rdxCli`.

The stored fields are:

- `enabled`
- `command`
- `argsPrefix`
- `workingDirectory`
- `env`
- `timeoutMs`
- `catalogPath`
- `jsonMode`

## Renderer Boundary

Renderer code can:

- read `tool:getCatalog`
- read `tool:getRuntimeSummary`
- subscribe to trace/workflow/conversation events

Renderer code cannot execute arbitrary RDX tools. Execution is owned by the main-process workflow/runtime path.
