# Agentic Trace Protocol

Agentic Trace is the current message-flow and run-projection contract for RDC-Agent.

## Storage

Runtime trace events are append-only JSONL records under the application state trace directory. Session-level right-panel state is projected through `TraceStateStore` and shared types in `src/shared/types/trace.ts`.

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
session-scoped agent task registry at `${userData}/state/tasks/{sessionId}` (`TaskRegistry` with the
`task_create` / `task_update` / `task_list` tools), mapped to `ProgressTask[]` by
`mapRightRailProgress` via `taskProjection`. It is session-scoped rather than per-run, so it stays populated
under the conversation-driven projection path (`buildConversationPresentation`). The list is a single
creation-order array; completed items stay in place. Agent task changes emit
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

Use `pnpm run check:fidelity` for `trace-*` anchors, `pnpm run typecheck` for shared contracts, and browser-session smoke for renderer projection changes.

## Progress lane

Progress is projected from session-scoped `TaskRegistry` records only. `RightRailProjectionService` does not synthesize tasks from UI stages, harness records, or plan text. Progress and the transcript live snapshot share one `taskProjection`; Work Process remains the event location target. Task work-trace blocks carry the same lifecycle status and blocked reason from `TaskRegistry`; ending a turn must not convert a pending or blocked task into a completed trace row.

## Outputs lane

`RightRailProjectionService` collects only explicit, user-recognizable output files through `SessionArtifactSource`. `output_register` is the only agent path into this lane: it accepts a completed file inside the active project, rejects `.rdx/inputs` and escaping paths, copies it into the owning run, and registers the copy. `ArtifactStore` may remain the backend registration mechanism, but the renderer contract exposes only user-facing sources: `report`, `evidence`, `image`, `document`, `data`, or `other`. The projection does not pin `plan.md`, does not scan arbitrary action payload paths, and does not expose internal producer names such as artifact store, run report, or action output. Current-run records are shown first, prior-run records are grouped as history, missing files remain visible as `failed`, and source inputs never enter this lane. The renderer names this lane Outputs; artifact terminology remains backend-only.

## Context and Capture lanes

`RightPanelViewModel.context` is intentionally not a generic group list. It retains `task` and `rdx` submodels as main-owned projection data, while the renderer presents them in different top-level areas: Context consumes only `task` resources, and Capture consumes `rdx` in every selected session: an absent input is rendered as its explicit empty state. `task` supplies concrete frozen-turn resources from Prompt segments and successful tool-result resource refs, plus attachments/uploads and important references; it is not a project/session/profile inventory. Generic tool names and configured-but-unused Skill/MCP entries never enter this lane, and renderer does not parse preview text to reconstruct them. `rdx` owns capture selection, Replay Device, open/preview/refresh/copy/clear, and compact diagnostics. contextId, replaySessionId, captureId, captureFileId, lease/runtime owner, remoteId, and remote status stay in the owner-scoped projection for agent consumption rather than rail inventory. Diagnostics are deduplicated and actionable. It does not include CLI catalog summaries, tool counts, or namespace inventory. Every context or capture event uses the `{ projectId, sessionId, payload }` envelope. The main process returns `null` without an owning scope; renderer caches background payloads by scope and projects only the active one. Non-owner sessions do not inherit an RDX snapshot.
