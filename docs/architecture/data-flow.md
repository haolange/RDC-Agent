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
  IPC-->>UI: message deltas, terminal messages and trace projection
```

Streaming updates of a message leave main as deltas (`src/shared/conversation/messageDelta.ts`): `WorkflowProjectionPublisher` turns each `message_patched` into a `message_delta` carrying only the fields and work-trace blocks that changed since its previous update of the same message, numbered by `seq`/`baseSeq`; the first update (`baseSeq: 0`) is complete. `message_completed` / `message_errored` stay whole and end the stream. The renderer's `conversationMessageAssembler` rebuilds the whole message before any store sees it; a delta that does not build on the last applied update (reload mid-turn, dropped event) is discarded and the stream resumes from `conversation:getMessageSnapshot`. One update therefore costs the same at step 300 as at step 3, instead of carrying the whole trace each time.

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
  else Android Replay Device (connected earlier by device:prepare)
    Session->>Runtime: reuse owning context: rd.capture.open_file + rd.capture.open_replay(options.remote_id)
  end
  Runtime->>Shell: fixed operation + args + frozen CLI settings
  Shell->>CLI: configured shell command
  CLI-->>Shell: stdout / stderr / exit code
  Shell-->>Runtime: ShellInvocationResult
  Runtime-->>Session: parsed JSON or fail-closed diagnostic
  Session-->>IPC: stable RdcRuntimeContext
  IPC-->>UI: context:changed and opened capture state
```

turn 冻结、lease/quarantine、`rdc_probe`、`capture_select / restore / recover` 等 RDC 操作契约见 [`rdc-runtime.md`](rdc-runtime.md)。

RDC installation details remain under `settings.tooling.rdcCli`. The main session boundary constructs the fixed native operation names and arguments, and freezes CLI settings for each turn; renderer and preload never construct lifecycle commands.

Local Open invokes `rd.capture.open_file` followed by `rd.capture.open_replay`. `rd.remote.connect` 在选择 Android Replay Device 时由 `device:prepare` 执行；Remote Open 复用该连接所属的 context，依次调用 `rd.capture.open_file` 与 `rd.capture.open_replay`，并以 `options.remote_id` 绑定已准备好的连接，返回的 `remote_id` 必须与所选连接一致。 Failures expose structured diagnostics (`message`, optional `classification` / `fix_hint`) rather than truncated CLI stderr alone.

## Trace Projection

```mermaid
sequenceDiagram
  participant Conversation as ConversationService
  participant Trace as TraceService
  participant IPC as trace IPC
  participant UI as ConversationThread / SessionRightRail

  Conversation->>Trace: publish conversation/tool/action events
  UI->>IPC: trace:getProjection
  IPC->>Trace: build AgentRunPresentation
  Trace-->>IPC: AgentRunPresentation
  IPC-->>UI: trace projection
```

`TraceService` builds renderer-facing `AgentRunPresentation` from conversation messages, action events, artifacts, and run summaries.

## Settings Flow

`SettingsService` is the single writer of `config.json`. It reads the file once at startup into a frozen `SettingsSnapshot { revision, user }`; every later read is in memory through narrow accessors: `snapshot()` for user sections, `providerConnections` (catalog facts + the user's provider state + secret presence, memoized until the provider states or the secrets change), `agentModelRoutes.resolve(agentId)`, `agentDefinitions()` (cached effective Agent profiles) and `rendererSettingsDto()` for the renderer's whole view; paths come from `appPathService`. `update` sanitizes and validates the patch, writes only a changed document, bumps the revision and broadcasts `settings:changed { revision, sections }`.

Inputs Settings does not own keep their own revisions: the secret store (secret map and decrypted values cached in memory), Agent manifests with project trust and the selected project, and the global instructions file. Writes through the app invalidate them; edits made outside the app are re-checked by file mtime and size when a turn is prepared (`startProfileTurn`) and when Settings opens (`settings:get`). Nothing polls.

Renderer Settings editors never invent provider/model facts; Effective Catalog and connection state come from main. Secret material stays in main-process opaque storage.
