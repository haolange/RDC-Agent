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
- `TraceExportResult`

Right-panel records use `traceLaneId`.

## IPC

Trace APIs:

- `trace:getRun`
- `trace:getEvents`
- `trace:getProjection`
- `trace:exportRun`
- `trace:switchBranch`
- `trace:exportSession`
- `trace:projectionChanged`

Workflow APIs remain responsible for start/approval/revision/restart/stop actions.

## Renderer

Renderer presentation is built from `AgentRunView`, `TraceRightPanel`, and renderer registry cards. Renderer code consumes projected state; it does not reconstruct raw trace storage or execute RDX tools.

## Verification

Use `npm run check:fidelity` for `trace-*` anchors, `npm run typecheck` for shared contracts, and browser-session smoke for renderer projection changes.
