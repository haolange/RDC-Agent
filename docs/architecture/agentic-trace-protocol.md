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

Progress lane（`RightPanelViewModel.progress`）只由 session 作用域的 `TaskRegistry`（`${userData}/state/tasks/{sessionId}`，工具 `task_create` / `task_update` / `task_list`）经 `taskProjection` 与 `mapRightRailProgress` 映射为 `ProgressTask[]`。`RightRailProjectionService` 不会从 UI 阶段、harness 记录或 plan 文本合成任务。它按 session 而非 run 作用域，因此在 conversation 驱动的投影路径（`buildConversationPresentation`）下同样有内容；列表是单一创建顺序数组，已完成项原位保留。Task 变化发出 `task.created` / `task.updated`，重新发布 `trace:projectionChanged` 并原位刷新该 lane。子代理的 task 只在内存 store 中，不写入 session lane。Progress 与 transcript live snapshot 共用同一 `taskProjection`，Work Process 仍是事件定位目标；task work-trace 块携带 `TaskRegistry` 的同一生命周期状态与 blocked 原因，回合结束不得把 pending 或 blocked 的 task 转成 completed 行。

## IPC

Trace APIs:

- `trace:getProjection`
- `trace:projectionChanged`

工作流生命周期走独立通道 `workflow:getState` / `workflow:resume` / `workflow:stop` / `workflow:getRunUsage`，不经 trace API。

## Renderer

Renderer presentation 由 `ConversationThread`（`src/renderer/features/transcript`）、`SessionRightRail`（`src/renderer/features/right-rail`）及 renderer registry cards 构建。 Renderer code consumes projected state; it does not reconstruct raw trace storage or execute RDC tools.

## Verification

Use `pnpm run check:fidelity` for `trace-*` anchors, `pnpm run typecheck` for shared contracts, and browser-session smoke for renderer projection changes.

## Artifacts lane

`RightRailProjectionService` projects Investigation Artifacts only from `investigationArtifactService.list` plus `listManifests`. The lane is `RightPanelViewModel.artifacts` (`InvestigationArtifactsPanelViewModel`). Superseded records are counted, not listed. The renderer never rebuilds this inventory from action events, working-directory scans, `artifactStore`, or `SessionArtifactSource`. Investigation records never enter Outputs.

## Outputs lane

`RightRailProjectionService` collects only explicit, user-recognizable output files through `SessionArtifactSource`. `output_register` is the only agent path into this lane: it accepts a completed file inside the active project, rejects `.rdc-agent/inputs` and escaping paths, copies it into the owning run, and registers the copy. `ArtifactStore` may remain the backend registration mechanism, but the renderer contract exposes only user-facing sources: `report`, `evidence`, `image`, `document`, `data`, or `other`. The projection does not surface live or frozen session plans, does not scan arbitrary action payload paths, and does not expose internal producer names such as artifact store, run report, or action output. Plan review lives on the transcript / Composer gate, not this lane. Current-run records are shown first, prior-run records are grouped as history, missing files remain visible as `failed`, and source inputs never enter this lane. The renderer names this lane Outputs. Investigation Artifacts use the separate Artifacts lane (`Progress / Artifacts / Outputs / Context / Capture`).

## Context and Capture lanes

`RightPanelViewModel.context` is intentionally not a generic group list. It retains `task` and `rdc` submodels as main-owned projection data, while the renderer presents them in different top-level areas: Context consumes only `task` resources, and Capture consumes `rdc` in every selected session: an absent input is rendered as its explicit empty state. `task` supplies concrete frozen-turn resources from Prompt segments and successful tool-result resource refs, plus attachments/uploads and important references; it is not a project/session/profile inventory. Generic tool names and configured-but-unused Skill/MCP entries never enter this lane, and renderer does not parse preview text to reconstruct them. `rdc` owns capture selection, Replay Device, open/preview/refresh/copy/clear, and compact diagnostics. contextId, replaySessionId, captureId, captureFileId, lease/runtime owner, remoteId, and remote status stay in the owner-scoped projection for agent consumption rather than rail inventory. Diagnostics are deduplicated and actionable. It does not include CLI catalog summaries, tool counts, or namespace inventory. Every context or capture event uses the `{ projectId, sessionId, payload }` envelope. The main process returns `null` without an owning scope; renderer caches background payloads by scope and projects only the active one. Non-owner sessions do not inherit an RDC snapshot.
