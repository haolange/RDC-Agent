# Session Projection 契约

> 产品边界与不变量以根目录 `DESIGN.md` 为 SSOT。本文约定 renderer **Active Session Projection**：主进程允许多 session 并行 turn，UI 只投影当前 active session；后台 session 事件写入 sidelined cache，切回时 hydrate。

## Active Session

- `projectStore.currentSession.sessionId` 是 renderer 唯一 active session。
- Main `session:select` / `session:create` 更新权威 current；不 abort 其它 session 的 active turn（多 session 并行是契约意图，见 `concurrencyContract`）。
- Capture 所有权仍按 `ownerSessionId` fail-closed（见 `permissions.md`）。

## IPC 门控

所有带 `sessionId` 的流式/投影事件在进入 active UI store 前必须经 `isActiveSessionEvent(sessionId)`：

| 事件族 | 门控字段 | Active 路径 | Background 路径 |
| --- | --- | --- | --- |
| `conversation:*` stream | `event.sessionId` | upsert active conversation | `sessionProjectionStore.projectSession` |
| `trace:projectionChanged` | `payload.sessionId` | `setTracePresentation` | cache workflow.trace |
| `workflow:stateChanged` | `state.sessionId`（若有） | `setWorkflowState` + 当前 session pull | cache only |
| `run:statusChanged` / usage | `runId` 或 `sessionId` | 已有 currentRun/session 比对 | ignore / cache |
| tool / evidence patches | turn 所属 `sessionId` 或 message 归属 | 仅更新 active message | cache |

**禁止**未门控直接 `upsertConversationMessage` / `setTracePresentation` / `setWorkflowState`。门禁：`pnpm run check:session-projection`。

## Composer Draft 与恢复

- Draft / pending attachments / pending skills 按 `{projectId}:{sessionId}` scope 隔离（`buildComposerSessionScopeKey`）。
- `lastSentPrompt` / `restoreComposerDraft` / Stop 恢复必须携带 owning `sessionId`（及 `projectId`）；恢复前校验与 `currentSession` 一致，否则跳过。
- Markdown Composer 输入以 `key={scopeKey}` remount，避免 CodeMirror 文档残留。

## Active Turn Context

Send 与 Rewrite 共用 session-scoped `ActiveTurnContext`：

```typescript
interface ActiveTurnContext {
  sessionId: string;
  projectId: string | null;
  requestId: string;
  optimisticTurnId: string | null;
  realTurnId: string | null;
}
```

- Session 切换时清空 context 与 `isPromptSending`。
- Stop 只读当前 session 的 context；禁止依赖跨 session 的 stale `activeRequestIdRef`。
- Monotonic stop 以 **`requestId` 为主**、`turnId` 为辅：optimistic → real turnId 替换后，已停止的 request 仍拒绝迟到 `draft`/`streaming` patch。

## Session 切换 Hygiene

切换或新建 session 时同步：

1. Immediate：`setConversationSnapshot([], null)`、`setTracePresentation(null)`、`setWorkflowState(null)`、clear usage / prepared turn；
2. Dispose 并重建 `conversationEventBatcher`（丢弃 pending RAF）；
3. Reset composer active turn context / lastSent（若 lastSent 不属于新 session）；
4. Async pull history / trace；若 cache 命中则优先 hydrate。

切回后台 session：`activateSession` 从 `sessionProjectionStore` hydrate，miss 则 IPC `getHistory` / `getProjection`。

## Stop / Rewrite

与 [`runtime-kernel.md`](runtime-kernel.md) 一致：

- `preparing` → 干净撤销（本 session 草稿恢复；transcript 不留本轮）；
- `committing` / `running` → 单调落停；
- Rewrite 提交立即写入 ActiveTurnContext；Stop 可在 optimistic 阶段按 `requestId` 落停，IPC reconcile 不得用 `streaming` 覆盖已停止 request。

## 验证

- 单元：`sessionEventGate`、composer restore session bind、monotonic requestId、projection cache activate。
- 静态：`pnpm run check:session-projection`。
- Browser QA：删尽 QA project sessions → 新建隔离 session → 多 session 串台 / Stop / Rewrite 矩阵（见 `AGENTS.md`）。

## Right Rail scoped payloads

Right Rail task resources and Capture state are scoped by the full `{ projectId, sessionId, payload }` envelope. `context:get`, `capture:getOpenedState`, preview, and clear requests require an explicit scope and return `null` when no owner scope exists. `context:changed`, `capture:openedStateChanged`, and session capture status updates use the same envelope. Renderer caches background payloads by owner session; only the active session hydrates Context resources and the always-visible Capture area, and late events from another session cannot overwrite either surface.

Outputs use the same session-owned projection path. `output_register` writes an explicit run-scoped artifact record after copying one completed project file; a refresh for that session projects it into Outputs. No renderer-side path discovery or background-session artifact event may populate the active rail.
