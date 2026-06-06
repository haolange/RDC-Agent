# Agentic Trace 协议

本文是 RDC-Agent 消息流与运行轨迹的**当前权威跨层契约**。它替代已废弃的 Agent Workstream Presentation Model（`items[]` / `TaskWorkstream` / `ProcessEvent`）。

## 1. 架构流水线

```text
AgentEvent / ActionEvent
        ↓
TraceEventStore (append-only JSONL)
        ↓
TraceTreeBuilder → TraceNode[]
        ↓
ProjectionBuilder → TimelineProjection
        ↓
TraceService → AgentRunPresentation
        ↓
IPC trace:* + trace:projectionChanged
        ↓
Renderer Registry → AgentRunView
```

设计原则：

- **单一事实源**：运行轨迹以 `TraceEvent` 追加写入，不从前端反推。
- **两层投影**：`TraceNode`（语义树）与 `TimelineNode`（UI 投影）分离；renderer 只消费 `TimelineProjection`。
- **注册表渲染**：`TimelineNode.renderer` 键映射到 `src/renderer/stream/renderer-registry.ts` 中的卡片组件。
- **Raw 隔离**：工具原始输入/输出仅在 Tool 卡片 Raw 标签、Inspector 或 session export 中出现，不铺满主消息流。

## 2. 持久化（JSONL，非 SQLite）

主进程实现：`src/main/agent-trace/TraceEventStore.ts`

| 路径 | 内容 |
| --- | --- |
| `{workspace}/.rdc-agent/trace/runs/{runId}.json` | `AgentRun` 元数据 |
| `{workspace}/.rdc-agent/trace/events/{runId}.jsonl` | 按 `seq` 追加的 `TraceEvent` |

裁决：

- 当前版本**刻意使用 JSONL 文件存储**，不引入 `better-sqlite3`；满足 append-only 审计、易导出、与 E2E/fixture 对齐。
- `TraceService` 对 action events **增量同步**：新 `event_id` 会追加到 event log，不会因已有事件而停止更新。
- 若未来需要跨 run 查询或压缩，可在不改变 `TraceEvent` 契约的前提下增加索引层；renderer 契约不变。

## 3. 共享类型（`src/shared/types/agenticTrace/`）

| 模块 | 职责 |
| --- | --- |
| `base.ts` | `AgentRun`、`TraceStatus`、`ArtifactRef`、`EvidenceRef` |
| `events.ts` | `TraceEvent`、`TraceEventType` |
| `nodes.ts` | 语义节点：`task_frame`、`thought_summary`、`tool_action`、`plan`、`phase_group`、`sub_agent`、`final_response`、`approval`… |
| `projection.ts` | `TimelineNode`、`TimelineProjection` |
| `presentation.ts` | `AgentRunPresentation`、`AgentRunViewModel` |
| `manifest.ts` | `ToolManifest`、`AgentProfile`（驱动 renderer 键与默认折叠） |
| `reasoning.ts` | `VisibleReasoningPacket`（runtime 可见推理 JSON 契约） |
| `previews.ts` / `normalized.ts` | 工具结果预览与归一化 |

右侧面板类型仍位于 `src/shared/types/workstream.ts`：`ProgressTask`、`WorkstreamArtifactRecord`、`WorkstreamContextRecord`、`RightPanelViewModel`。


## 4. 主进程模块

| 文件 | 职责 |
| --- | --- |
| `TraceEventEmitter.ts` | `AgentEvent` / `ActionEvent` → `TraceEvent` |
| `TraceTreeBuilder.ts` | `TraceEvent[]` → `TraceNode[]`（含 phase 分组） |
| `ProjectionBuilder.ts` | `TraceNode[]` → `TimelineProjection` |
| `ToolResultNormalizer.ts` | 工具输出 → `NormalizedToolResult` + preview |
| `TraceService.ts` | 编排：会话级 `AgentRunPresentation` |
| `manifests/ToolManifestRegistry.ts` | 工具 → renderer 键 |
| `manifests/AgentProfileRegistry.ts` | Agent 阶段折叠策略 |

## 5. IPC / Preload 契约

| Channel | 方向 | 载荷 |
| --- | --- | --- |
| `trace:getRun` | invoke | `{ run: AgentRun \| null }` |
| `trace:getEvents` | invoke | `{ events: TraceEvent[] }` |
| `trace:getProjection` | invoke | `TraceSessionResult` |
| `trace:exportRun` | invoke | `{ run, events }` |
| `trace:projectionChanged` | push | `{ sessionId, presentation: AgentRunPresentation }` |

Workflow 域仍保留 plan revision / branch / export 入口，但 presentation 字段统一为 `AgentRunPresentation`：

- `workflow:getWorkstreamSession` → `{ success, presentation }`
- `workflow:requestPlanRevision` → `TraceRevisionResult`
- `workflow:switchWorkstreamBranch` → `TraceBranchSwitchResult`

**已删除**：`workflow:workstreamChanged`、`onWorkstreamChanged`。

Conversation turn 结果字段：`tracePresentation`（非 `workstreamPresentation`）。

## 6. Renderer 契约

入口：`src/renderer/features/debugger/AgentChat` → `AgentRunView`

| 组件 | testid |
| --- | --- |
| `AgentRunView` | `agent-run-view` |
| `TimelinePanel` | `trace-timeline` |
| `RunHeader` | `trace-run-header` |
| `TaskFrameCard` | `trace-task-frame` |
| `ThoughtSummaryCard` | `trace-thought-summary` |
| `ToolActionCard` | `trace-tool-action` |
| `PlanCard` | `trace-plan-card` |
| `SubAgentCard` | `trace-sub-agent` |
| `FinalResponseCard` | `trace-final-response` |
| `InspectorPanel` | `trace-inspector` |

状态存储：`workflowStore.tracePresentation`，由 `onTraceProjectionChanged` 刷新。

## 7. Runtime 输出契约

`AgentRuntime` 在 system prompt 末尾注入 `VisibleReasoningPacket` JSON 约束。

`resources/agent-runtime/patterns/plan-generate-verify.json` 含 `traceOutputContract`：

```json
{
  "visibleReasoning": "VisibleReasoningPacket",
  "toolResults": "normalized_preview",
  "finalResponse": "markdown",
  "rawTraceVisibility": "inspector_only"
}
```

## 8. 浏览器真实会话

浏览器真实会话是 agent 日常开发验证入口：

- 主进程启动 localhost bridge，并输出 `http://127.0.0.1:<port>/app`。
- Electron window 通过 `preload -> IPC` 进入主进程；浏览器通过 `localhost bridge -> IPC handler registry` 进入同一主进程。
- 浏览器会话使用真实 workspace、settings、LLM runtime、Trace projection、conversation event 和 ToolBridge，不再使用渲染层本地样本或伪造模型。
- Renderer 仍只调用 `window.electronAPI`；Electron 环境由 preload 注入，浏览器环境由 `installBrowserAppBridge()` 注入。

## 9. 验证入口

| 类型 | 路径 |
| --- | --- |
| Golden fixture | `fixtures/traces/agentic-trace-basic.json` |
| Browser session smoke | `e2e/browser-session.spec.ts` |
| Electron shell smoke | `e2e/shell-smoke.spec.ts` |

门禁：`npm run check:fidelity`（`trace-*` testid）、`npm run typecheck`、`npm run build`、`npm run test:browser-session`；涉及窗口、preload、IPC、workspace 权限或 ToolBridge/RenderDoc 本地链路时补 `npm run test:shell-smoke`。

## 10. 工具目录元数据

`resources/tools/spec/tool_catalog.json` 的 `tool_count` 必须等于 `tools.length`（当前为 200）。生成脚本应保持一致；`ToolBridge.getSessionStatus` 使用 `rd.session.get_context`。

## 11. 文档权威关系

新实现、新 PR、新 Codex Goal 必须以本文与 `DESIGN.md` 为准；不要恢复旧 workstream 模型或 renderer-only 预览双轨。
