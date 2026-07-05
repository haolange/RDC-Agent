# Agentic Trace Protocol

Agentic Trace is the current message-flow and run-projection contract for RDC-Agent.

## Storage

Runtime trace events are append-only JSONL records under the workspace trace directory. Session-level right-panel state is projected through `TraceStateStore` and shared types in `src/shared/types/trace.ts`.

## Shared Types

Primary contracts:

- `AgentRunPresentation`
- `AgentRunViewModel`
- `TraceEvent`
- `TraceNode`
- `ProgressTask`
- `TraceArtifactRecord`
- `TraceContextRecord`
- `RightPanelViewModel`
- `TraceRevisionResult`
- `TraceBranchSwitchResult`

Right-panel records use `traceLaneId`.

## Progress lane

The right-panel Progress lane (`RightPanelViewModel.progress`) is projected from the
session-scoped agent task registry at `workspace/.tasks/{sessionId}` (`TaskRegistry` with the
`task_create` / `task_update` / `task_list` tools), mapped to `ProgressTask` by
`TraceService.mapSessionProgress`. It is session-scoped rather than per-run, so it stays populated
under the conversation-driven projection path (`buildConversationPresentation`). `current` holds
pending / running / blocked steps; `history` holds completed steps. Agent task changes emit
`task.created` / `task.updated`, which republish `trace:projectionChanged` and refresh the lane in
place. Subagents keep their tasks in an in-memory store and never write to the session lane. The
harness `task-board.json` no longer feeds this lane.

## IPC

Trace APIs:

- `trace:getRun`
- `trace:getEvents`
- `trace:getProjection`
- `trace:exportRun`
- `trace:switchBranch`
- `trace:projectionChanged`

Workflow APIs remain responsible for start/approval/revision/restart/stop actions.

## Renderer

Renderer presentation is built from `AgentRunView`, `TraceRightPanel`, and renderer registry cards. Renderer code consumes projected state; it does not reconstruct raw trace storage or execute RDX tools.

## Verification

Use `npm run check:fidelity` for `trace-*` anchors, `npm run typecheck` for shared contracts, and browser-session smoke for renderer projection changes.
