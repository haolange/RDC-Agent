# Agent Workstream Technical Contract

## 1. 目标

本文定义 Agent Workstream 的跨层技术契约，目标是让 UI 消费产品级事件和 presentation model，而不是直接从 raw debug trace、SDK span 或 workflow 内部字段中猜结构。

本契约必须遵守当前 RDC-Agent 分层：

- `src/shared` 定义跨层类型和常量。
- `src/main` 维护 workflow runtime、session、artifact、context、tool trace 和 projection。
- `src/preload` 暴露受控 ElectronAPI。
- `src/renderer` 消费 presentation model 并渲染 UI。
- `src/renderer/platform/browserFallback` 提供 Browser Preview 样本能力，但不代表真实 Electron runtime。

RenderDoc 工具链必须保持 `renderer -> preload -> IPC -> ToolBridge -> resources/tools/rdx.bat`。Agent SDK 只能经 `AgentRunnerPort` 作为 stage 内 runner 接入。

## 2. 核心实体

### 2.1 AgentWorkstreamSession

表示一个 session 内的 workstream 视图聚合。

关键字段：

```ts
interface AgentWorkstreamSession {
  sessionId: string;
  activeBranchId: string;
  workstreams: TaskWorkstream[];
  progress: ProgressTask[];
  artifacts: WorkstreamArtifactRecord[];
  context: WorkstreamContextRecord[];
  branches: RequestBranchGroup[];
}
```

### 2.2 TaskWorkstream

一次可交付结果的 agent task。

```ts
type WorkstreamType = 'ask' | 'debugger' | 'analyzer' | 'optimizer';
type WorkstreamStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'awaiting_approval';
type WorkstreamDensity = 'expanded' | 'compact';
type WorkstreamResultKind = 'answer' | 'plan' | 'report' | 'failure' | 'cancelled' | 'visual_report_summary';

interface TaskWorkstream {
  id: string;
  sessionId: string;
  branchId: string;
  type: WorkstreamType;
  status: WorkstreamStatus;
  density: WorkstreamDensity;
  resultKind?: WorkstreamResultKind;
  sourceRequestRevisionId?: string;
  parentWorkstreamId?: string;
  startedAt: string;
  completedAt?: string;
  processEvents: ProcessEvent[];
  result?: TaskResultRecord;
}
```

TaskWorkstream 按可交付结果划分，不按 tool call、runtime loop 或固定 workflow phase 划分。

### 2.3 UserRequest / Branch

用户 prompt 支持 Copy/Edit。Edit 不覆盖历史，而是创建新的 revision / branch。

```ts
interface UserRequest {
  id: string;
  sessionId: string;
  rootRevisionId: string;
  activeRevisionId: string;
  revisions: UserRequestRevision[];
}

interface UserRequestRevision {
  id: string;
  requestId: string;
  branchId: string;
  parentRevisionId?: string;
  prompt: string;
  createdAt: string;
  resultingWorkstreamIds: string[];
}

interface RequestBranchGroup {
  id: string;
  rootRequestId: string;
  activeBranchId: string;
  branches: RequestBranch[];
}

interface RequestBranch {
  id: string;
  parentBranchId?: string;
  revisionId: string;
  status: 'active' | 'inactive' | 'abandoned' | 'completed';
  workstreamIds: string[];
}
```

第一版可以只预留这些类型和 presentation model，不强制完成完整 branch UI；但实现 Edit 时不得覆盖历史 prompt。

### 2.4 ProcessEvent

ProcessEvent 是消息流过程轨迹的产品事件，不等同 raw trace。

```ts
type ProcessEvent =
  | AgentTextEvent
  | ToolEvent
  | SubAgentEvent
  | UserConfirmationEvent
  | UserRevisionEvent;
```

#### AgentTextEvent

```ts
interface AgentTextEvent {
  kind: 'agent.text';
  id: string;
  workstreamId: string;
  createdAt: string;
  text: string;
}
```

连续 `agent.text` 可以在 presentation layer 合并为 Agent Thinking Bubble。

#### ToolEvent

```ts
type ToolStatus = 'running' | 'done' | 'failed' | 'skipped';

interface ToolEvent {
  kind: 'tool';
  id: string;
  workstreamId: string;
  taskId?: string;
  createdAt: string;
  completedAt?: string;
  status: ToolStatus;
  title: string;
  summary: string;
  target?: string;
  durationMs?: number;
  inputRef?: string;
  outputRef?: string;
  artifactIds?: string[];
  rawTraceRef?: string;
  errorSummary?: string;
}
```

ToolEvent 可以关联 Progress task，但不会自动创建 Progress task。

#### SubAgentEvent

```ts
interface SubAgentEvent {
  kind: 'subagent';
  id: string;
  workstreamId: string;
  taskId?: string;
  createdAt: string;
  completedAt?: string;
  status: ToolStatus;
  label: string;
  summary: string;
  resultSummary?: string;
  nestedWorkstream?: NestedWorkstreamPresentation;
  rawTraceRef?: string;
}
```

Sub Agent 是特殊 tool-like call。它可以展示 nested workstream，但 nested workstream 不允许继续包含 sub agent。

#### User Confirmation / Revision

```ts
interface UserConfirmationEvent {
  kind: 'user.confirmed';
  id: string;
  workstreamId: string;
  planId: string;
  createdAt: string;
  label: string;
}

interface UserRevisionEvent {
  kind: 'user.revision_requested';
  id: string;
  workstreamId: string;
  planId: string;
  createdAt: string;
  prompt: string;
}
```

这些事件必须进入消息流历史，而不只是内部状态变化。

## 3. ProgressTask

Progress task 是目标，不是工具日志。

```ts
type ProgressTaskStatus = 'pending' | 'running' | 'completed' | 'blocked' | 'reopened' | 'cancelled';

interface ProgressTask {
  id: string;
  sessionId: string;
  workstreamId: string;
  branchId: string;
  title: string;
  status: ProgressTaskStatus;
  order: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  source: 'plan' | 'runtime';
  linkedEventIds?: string[];
  blockerSummary?: string;
}
```

事件：

- `task.created`
- `task.started`
- `task.updated`
- `task.completed`
- `task.blocked`
- `task.reopened`
- `task.cancelled`

规则：

- Plan 初始化 Progress task list。
- Runtime 执行中可以追加、更新、完成、阻塞、重新打开或取消 task。
- Tool/Sub Agent 通过 `taskId` 关联 task。
- UI 不从 tool call 自动推断 task。

## 4. ArtifactRecord

Artifacts 是正式产物。

```ts
type WorkstreamArtifactType =
  | 'plan'
  | 'report'
  | 'generative_ui'
  | 'visual_report'
  | 'evidence_bundle'
  | 'failure_summary'
  | 'cancelled_summary'
  | 'other';

type ArtifactStatus = 'draft' | 'ready' | 'failed' | 'superseded';

interface WorkstreamArtifactRecord {
  id: string;
  sessionId: string;
  workstreamId: string;
  branchId: string;
  sourceEventId?: string;
  type: WorkstreamArtifactType;
  status: ArtifactStatus;
  displayName: string;
  path?: string;
  uri?: string;
  rawRef?: string;
  createdAt: string;
  updatedAt: string;
}
```

绑定粒度：

- 必须绑定 session。
- 必须绑定 Task Workstream。
- 可以绑定 source event。

右侧按 session 汇总，当前 task 置顶，历史折叠。Task Result Block 和右侧 Artifacts 引用同一份 artifact record。

## 5. ContextRecord

Context 是依据和高层能力索引。

```ts
type ContextKind = 'capture' | 'file' | 'source' | 'capability';
type ContextImportance = 'normal' | 'important' | 'cited' | 'decisive';

interface WorkstreamContextRecord {
  id: string;
  sessionId: string;
  workstreamId?: string;
  branchId?: string;
  kind: ContextKind;
  label: string;
  summary?: string;
  importance: ContextImportance;
  firstObservedAt: string;
  lastObservedAt: string;
  sourceEventIds?: string[];
  artifactIds?: string[];
  detailsRef?: string;
}
```

Context 分组：

- Captures
- Files
- Sources
- Capabilities

Capture context 可以包含：

- `.rdc` 文件
- event id
- draw call
- pipeline state
- shader
- texture / render target

事件：

- `context.observed`
- `context.marked_important`
- `context.cited`
- `context.deciding_evidence`

规则：

- 自动记录全部。
- agent 可标记 important / cited / decisive。
- UI 默认显示重要项，展开显示全部。
- secret、token、完整敏感请求体不得进入 renderer 可见 context。

## 6. Plan 状态机

```ts
type PlanStatus =
  | 'draft'
  | 'awaiting_approval'
  | 'accepted'
  | 'needs_revision'
  | 'superseded'
  | 'executed'
  | 'failed';
```

语义：

- `draft`：生成中。
- `awaiting_approval`：已生成，等待同意执行或修改建议。
- `accepted`：用户已同意，可作为 execution 输入。
- `needs_revision`：用户已输入修改建议，新 Revision Workstream 正在生成。
- `superseded`：新 Plan 已生成，旧 Plan 被替代。
- `executed`：基于该 Plan 的 execution 已完成。
- `failed`：Plan 生成失败或后续关联失败。

latest plan 分两类：

- latest displayed plan：UI 最新显示的 plan，可以未被 accepted。
- latest accepted plan：最新被用户 accepted 的 plan，execution 只能读取它。

执行规则：

- 未 accepted plan 不允许进入 execution。
- revision 不覆盖旧 plan。
- 消息流严格按历史时间保留，不按 latest 重排。

## 7. TaskResultRecord

```ts
interface TaskResultRecord {
  id: string;
  workstreamId: string;
  kind: WorkstreamResultKind;
  status: string;
  title: string;
  sections: TaskResultSection[];
  artifactIds: string[];
  createdAt: string;
}

interface TaskResultSection {
  id: string;
  title: string;
  body: string;
  severity?: 'normal' | 'info' | 'warning' | 'error';
  contextIds?: string[];
}
```

Plan Result sections：

- 目标
- 已知事实
- 假设 / 判断
- 执行路线
- 验收标准
- 风险 / 阻断
- 预计产物

Final Report sections：

- 结论
- 关键证据
- 已完成验证
- 剩余风险
- 产物入口

Failure / Cancelled Result 必须有对应收束 section。

## 8. Report 与 Generative UI

`report.md` 是 canonical report。

Generative UI / Visual Report 是从 `report.md` 或同一份 structured report data 派生的 presentation layer。它不能引入 report 中没有的新事实或新结论。

技术约束：

- Report artifact 和 Generative UI artifact 必须绑定同一 workstream。
- Generative UI 需要记录 source report artifact id。
- 如果生成失败，不影响 canonical `report.md` 的可访问性。

## 9. Presentation Model

Renderer 不应直接渲染 raw runtime trace。

建议 presentation model：

```ts
interface AgentWorkstreamPresentation {
  sessionId: string;
  activeBranchId: string;
  items: MessageStreamItem[];
  rightPanel: RightPanelViewModel;
}

type MessageStreamItem =
  | UserPromptBubbleViewModel
  | TaskWorkstreamViewModel
  | UserConfirmationViewModel
  | UserRevisionViewModel;

interface TaskWorkstreamViewModel {
  id: string;
  type: WorkstreamType;
  status: WorkstreamStatus;
  density: WorkstreamDensity;
  prompt?: UserPromptBubbleViewModel;
  process: ProcessTraceViewModel;
  result?: TaskResultViewModel;
}

interface RightPanelViewModel {
  progress: ProgressPanelViewModel;
  artifacts: ArtifactsPanelViewModel;
  context: ContextPanelViewModel;
}
```

转换链路：

```text
runtime/session data
  -> product events
  -> AgentWorkstreamPresentation
  -> renderer components
```

禁止链路：

```text
raw debug trace
  -> renderer guesses chat nodes
```

## 10. Browser Preview Scenario

Browser Preview 可以使用稳定 scenario 验证 renderer UI：

- Ask task
- Debug Plan awaiting approval
- Execute accepted plan
- Revision request
- Execution report
- Failed tool
- Failed task
- Cancelled task
- Sub agent nested trace
- Long prompt collapse
- Artifacts / Context accumulation
- Branch navigator

但 Browser Preview 不代表真实 Electron、preload、IPC、main process、workspace、ToolBridge 或 RenderDoc 工具链。

## 11. 跨层触点

实现该契约时必须同步检查：

- `src/shared/types/workstream.ts`：Agent Workstream 共享契约。
- `src/main/workflow/debugger/AgentWorkstreamProjector.ts`、`WorkstreamStateStore.ts`、`DebugWorkflowService.ts`：Debugger runtime、Plan/approval/revision/execution/export 投影。
- `src/main/conversation/*`：conversation-to-workflow glue、用户确认/修订消息。
- `src/main/reports/*`：ArtifactStore、EvidenceLedger、ReportBundleService。
- `src/main/tools/*`：ToolBridge、ToolTraceEntry、tool metadata。
- `src/preload/api/*`：受控 API 暴露。
- `src/renderer/features/debugger/AgentChat`、`AgentWorkstream`、`PlanIntakePanel`、`ControlPanel/WorkstreamRightPanel.tsx`：消息流、composer approval overlay、右侧 Progress / Artifacts / Context。
- `src/renderer/platform/browserFallback/*`：Browser Preview scenario、fallback state 和 fallback workstream API。

## 12. 安全与脱敏

- API key、OAuth token、secret 不得进入 renderer 可见 context、raw tab 或 export。
- LLM raw payload 可以通过 redacted raw reference 追溯，不能默认展示完整敏感请求体。
- Tool stderr/stdout 默认只显示摘要，Raw tab 中也必须遵守脱敏规则。
- Context 中的 provider/model route 只能显示脱敏状态、model id、usage 和错误分类。

## 13. 与现有架构的关系

本文是跨层契约；当前 Debugger 实现通过 shared workstream 类型、main projector/store、workflow IPC/preload API、renderer Agent Workstream 组件和 Browser Preview scenario 承接该链路。Analyzer / Optimizer 只保留类型和 presentation 预留。

不得因此改变以下当前边界：

- `Ask` 不创建正式 run。
- Analyzer / Optimizer 不被写成当前已完成执行能力。
- Agent SDK 不决定顶层 workflow gate。
- ToolBridge 是唯一 RenderDoc 工具出口。
- Browser Preview 只验证 renderer fallback。
