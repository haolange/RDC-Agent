# Data Flow

本文描述当前 project state、agent turn、Agentic Trace projection 和 RDX shell action 的跨层流向。

## Agent Turn

```mermaid
sequenceDiagram
  participant UI as Renderer Composer
  participant API as Preload API
  participant IPC as Main IPC
  participant Conversation as ConversationService
  participant Orchestrator as AgentOrchestrator
  participant Runtime as Agent Runtime
  participant Provider as LLM Provider
  participant Tools as Runtime Tools

  UI->>API: conversation.sendMessage(agentId, message)
  API->>IPC: conversation:sendMessage
  IPC->>Conversation: create user/assistant turn
  Conversation->>Orchestrator: sendProfileMessage(agentId)
  Orchestrator->>Runtime: run agent with manifest instructions and tool policy
  Runtime->>Provider: stream model response
  Runtime->>Tools: execute allowed tools
  Tools-->>Runtime: tool result / policy denial
  Runtime-->>Conversation: streamed assistant events
  Conversation-->>IPC: conversation events
  IPC-->>UI: message patches and trace projection
```

`.agent.md` is the source for instructions, model, tools, agent handoffs, skills, MCP servers, and invocability. `plan.md` is a normal artifact or message output, not a workflow IPC state.

## RDX Shell Actions

```mermaid
sequenceDiagram
  participant UI as Renderer
  participant IPC as Main IPC
  participant Session as RdxRuntimeContextService
  participant Action as RdxShellActionService
  participant Shell as ShellInvocationService
  participant CLI as System-installed RDX CLI

  UI->>IPC: capture:openProjectInput / context:openHumanPreview
  IPC->>Session: run configured action
  Session->>Action: openCapture / connectRemote / openPreview / closeRuntime
  Action->>Shell: command + args + cwd + env
  Shell->>CLI: configured shell command
  CLI-->>Shell: stdout / stderr / exit code
  Shell-->>Action: ShellInvocationResult
  Action-->>Session: parsed JSON or fail-closed diagnostic
  Session-->>IPC: stable RdxRuntimeContext
  IPC-->>UI: context:changed and opened capture state
```

RDX command details are Settings data under `settings.tooling.rdxActions`. The repository does not hardcode RDX CLI tool names, command args, cwd, env, or fallback repository paths in renderer/preload call sites.

## Trace Projection

```mermaid
sequenceDiagram
  participant Conversation as ConversationService
  participant Trace as TraceService
  participant IPC as trace IPC
  participant UI as AgentRunView / TraceRightPanel

  Conversation->>Trace: publish conversation/tool/action events
  UI->>IPC: trace:getProjection / trace:getRun / trace:getEvents
  IPC->>Trace: build AgentRunPresentation
  Trace-->>IPC: AgentRunPresentation
  IPC-->>UI: trace projection
```

`TraceService` builds renderer-facing `AgentRunPresentation` from conversation messages, action events, artifacts, and run summaries.

## Settings Flow

Settings are persisted by `SettingsService`, sanitized before write, and exposed to renderer through settings IPC.

Relevant settings groups:

- `settings.agents.definitions`: loaded from baseline `.agent.md` profiles such as Ask, Plan, Edit, Debugger, Analyzer, and Optimizer.
- `settings.llm.agentRoutes`: provider/model route for each top-level agent.
- `settings.tooling.rdxActions`: configured shell actions for RDX runtime context.
- `settings.tooling.rdxCli`: optional catalog/runtime summary configuration.

Renderer code can read settings, catalog, runtime summary, trace, and context projections. Actual shell execution is owned by main process services.
