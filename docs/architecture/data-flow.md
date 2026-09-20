# Data Flow

本文描述当前 project state、agent turn、Agentic Trace projection 和 RDC shell action 的跨层流向。

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

`.agent.md` is the source for instructions, model, tools, agent handoffs, skills, MCP servers, and invocability. `plan_artifact` is a human-in-the-loop pause with a live session plan and a frozen approved copy; it is not a Right Rail output.

## RDC Shell Actions

```mermaid
sequenceDiagram
  participant UI as Renderer
  participant IPC as Main IPC
  participant Session as RdcSessionService
  participant Runtime as RdcSessionRuntime
  participant Shell as ShellInvocationService
  participant CLI as System-installed RDC-Tool CLI

  UI->>IPC: capture:openProjectInput / capture:refreshFrame
  IPC->>Session: openProjectInput or preview
  alt Local Replay Device
    Session->>Runtime: rd.capture.open_file + rd.capture.open_replay
  else Android Replay Device
    Session->>Runtime: rd.remote.connect then capture operations
  end
  Runtime->>Shell: fixed operation + args + frozen CLI settings
  Shell->>CLI: configured shell command
  CLI-->>Shell: stdout / stderr / exit code
  Shell-->>Runtime: ShellInvocationResult
  Runtime-->>Session: parsed JSON or fail-closed diagnostic
  Session-->>IPC: stable RdcRuntimeContext
  IPC-->>UI: context:changed and opened capture state
```

RDC installation details remain under `settings.tooling.rdcCli`. The main session boundary constructs the fixed native operation names and arguments, and freezes CLI settings for each turn; renderer and preload never construct lifecycle commands.

Local Open invokes `rd.capture.open_file` followed by `rd.capture.open_replay`. Remote Open first invokes `rd.remote.connect`, then passes its returned `remote_id` to the replay operation. Failures expose structured diagnostics (`message`, optional `classification` / `fix_hint`) rather than truncated CLI stderr alone.

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
