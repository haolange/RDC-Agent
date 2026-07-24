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
  participant Session as RdxSessionService
  participant Action as RdxShellActionService
  participant Shell as ShellInvocationService
  participant CLI as System-installed RDX CLI

  UI->>IPC: capture:openProjectInput / context:openHumanPreview
  IPC->>Session: openProjectInput or preview
  alt Local Replay Device
    Session->>Action: openCapture
  else Android Replay Device
    Session->>Action: connectRemote via ReplayDeviceService then openRemoteCapture
  end
  Action->>Shell: command + args + cwd + env
  Shell->>CLI: configured shell command
  CLI-->>Shell: stdout / stderr / exit code
  Shell-->>Action: ShellInvocationResult
  Action-->>Session: parsed JSON or fail-closed diagnostic
  Session-->>IPC: stable RdxRuntimeContext
  IPC-->>UI: context:changed and opened capture state
```

RDX command details are Settings data under `settings.tooling.rdxActions` (`openCapture`, `openRemoteCapture`, `connectRemote`, `openPreview`, `closeRuntime`). The repository does not hardcode RDX CLI tool names, command args, cwd, env, or fallback repository paths in renderer/preload/main call sites for these vertical UI actions.

Local Open uses `capture open --file {{capturePath}}`. Remote Open uses the same facade with `--remote-id {{remoteId}}` after `connectRemote` prepares a live handle. Failures must expose structured diagnostics (`message`, optional `classification` / `fix_hint`) rather than truncated CLI stderr alone.

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

Renderer Settings editors never invent provider/model facts; Effective Catalog and connection state come from main. Secret material stays in main-process opaque storage.
