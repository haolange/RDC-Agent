import type { AppMode } from './session';

export type WorkstreamType = 'ask' | 'debugger' | 'analyzer' | 'optimizer';

export type WorkstreamStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'awaiting_approval';

export type WorkstreamDensity = 'expanded' | 'compact';

export type WorkstreamResultKind =
  | 'answer'
  | 'plan'
  | 'report'
  | 'failure'
  | 'cancelled'
  | 'visual_report_summary';

export type PlanStatus =
  | 'draft'
  | 'awaiting_approval'
  | 'accepted'
  | 'needs_revision'
  | 'superseded'
  | 'executed'
  | 'failed';

export type ToolStatus = 'running' | 'done' | 'failed' | 'skipped';

export interface RawAuditRef {
  id: string;
  label: string;
  eventId?: string;
  runId?: string;
  sessionId?: string;
  ref?: string;
}

export interface AgentTextEvent {
  kind: 'agent.text';
  id: string;
  workstreamId: string;
  createdAt: string;
  text: string;
}

export interface ToolEvent {
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

export interface NestedWorkstreamPresentation {
  id: string;
  title: string;
  process: ProcessEvent[];
  result?: TaskResultRecord;
}

export interface SubAgentEvent {
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

export interface UserConfirmationEvent {
  kind: 'user.confirmed';
  id: string;
  workstreamId: string;
  planId: string;
  createdAt: string;
  label: string;
}

export interface UserRevisionEvent {
  kind: 'user.revision_requested';
  id: string;
  workstreamId: string;
  planId: string;
  createdAt: string;
  prompt: string;
}

export type ProcessEvent =
  | AgentTextEvent
  | ToolEvent
  | SubAgentEvent
  | UserConfirmationEvent
  | UserRevisionEvent;

export type ProgressTaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'blocked'
  | 'reopened'
  | 'cancelled';

export interface ProgressTask {
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

export type WorkstreamArtifactType =
  | 'plan'
  | 'report'
  | 'generative_ui'
  | 'visual_report'
  | 'evidence_bundle'
  | 'failure_summary'
  | 'cancelled_summary'
  | 'other';

export type ArtifactStatus = 'draft' | 'ready' | 'failed' | 'superseded';

export interface WorkstreamArtifactRecord {
  id: string;
  sessionId: string;
  workstreamId: string;
  branchId: string;
  sourceEventId?: string;
  type: WorkstreamArtifactType;
  status: ArtifactStatus;
  displayName: string;
  taskTitle?: string;
  path?: string;
  uri?: string;
  rawRef?: string;
  createdAt: string;
  updatedAt: string;
}

export type ContextKind = 'capture' | 'file' | 'source' | 'capability';
export type ContextImportance = 'normal' | 'important' | 'cited' | 'decisive';

export interface WorkstreamContextRecord {
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

export interface TaskResultSection {
  id: string;
  title: string;
  body: string;
  severity?: 'normal' | 'info' | 'warning' | 'error';
  contextIds?: string[];
}

export interface TaskResultRecord {
  id: string;
  workstreamId: string;
  kind: WorkstreamResultKind;
  status: PlanStatus | WorkstreamStatus | 'ready';
  title: string;
  sections: TaskResultSection[];
  artifactIds: string[];
  createdAt: string;
}

export interface UserRequestRevision {
  id: string;
  requestId: string;
  branchId: string;
  parentRevisionId?: string;
  prompt: string;
  createdAt: string;
  resultingWorkstreamIds: string[];
}

export interface UserRequest {
  id: string;
  sessionId: string;
  rootRevisionId: string;
  activeRevisionId: string;
  revisions: UserRequestRevision[];
}

export type RequestBranchStatus = 'active' | 'inactive' | 'abandoned' | 'completed';

export interface RequestBranch {
  id: string;
  parentBranchId?: string;
  revisionId: string;
  status: RequestBranchStatus;
  workstreamIds: string[];
}

export interface RequestBranchGroup {
  id: string;
  rootRequestId: string;
  activeBranchId: string;
  branches: RequestBranch[];
}

export interface TaskWorkstream {
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
  planId?: string;
  planStatus?: PlanStatus;
}

export interface AgentWorkstreamSession {
  sessionId: string;
  activeBranchId: string;
  latestDisplayedPlanId?: string;
  latestAcceptedPlanId?: string;
  userRequests: UserRequest[];
  workstreams: TaskWorkstream[];
  progress: ProgressTask[];
  artifacts: WorkstreamArtifactRecord[];
  context: WorkstreamContextRecord[];
  branches: RequestBranchGroup[];
  rawAuditRefs: RawAuditRef[];
  updatedAt: string;
}

export interface UserPromptBubbleViewModel {
  kind: 'user_prompt';
  id: string;
  branchId: string;
  requestId: string;
  revisionId: string;
  prompt: string;
  createdAt: string;
  branchIndex: number;
  branchCount: number;
  canCopy: boolean;
  canEdit: boolean;
  branchNavigator?: BranchNavigatorViewModel | null;
}

export interface AgentThinkingBubbleViewModel {
  kind: 'agent_thinking';
  id: string;
  createdAt: string;
  text: string;
}

export interface ToolRowViewModel {
  kind: 'tool_row';
  id: string;
  createdAt: string;
  completedAt?: string;
  status: ToolStatus;
  title: string;
  summary: string;
  target?: string;
  durationMs?: number;
  taskId?: string;
  artifactIds: string[];
  rawTraceRef?: string;
  inputRef?: string;
  outputRef?: string;
  errorSummary?: string;
}

export interface SubAgentRowViewModel {
  kind: 'subagent_row';
  id: string;
  createdAt: string;
  completedAt?: string;
  status: ToolStatus;
  label: string;
  summary: string;
  resultSummary?: string;
  taskId?: string;
  nestedWorkstream?: NestedWorkstreamPresentation;
  rawTraceRef?: string;
}

export interface UserConfirmationViewModel {
  kind: 'user_confirmation';
  id: string;
  workstreamId: string;
  planId: string;
  label: string;
  createdAt: string;
}

export interface UserRevisionViewModel {
  kind: 'user_revision';
  id: string;
  workstreamId: string;
  planId: string;
  prompt: string;
  createdAt: string;
}

export type ProcessTraceItemViewModel =
  | AgentThinkingBubbleViewModel
  | ToolRowViewModel
  | SubAgentRowViewModel;

export interface ProcessTraceViewModel {
  collapsed: boolean;
  items: ProcessTraceItemViewModel[];
  thinkingDurationMs?: number;
}

export interface TaskResultViewModel extends TaskResultRecord {
  artifacts: WorkstreamArtifactRecord[];
}

export interface TaskWorkstreamViewModel {
  kind: 'task_workstream';
  id: string;
  type: WorkstreamType;
  status: WorkstreamStatus;
  density: WorkstreamDensity;
  title: string;
  startedAt: string;
  completedAt?: string;
  /** @deprecated prompt is now rendered as an independent MessageStreamItem before the task workstream */
  prompt?: UserPromptBubbleViewModel;
  process: ProcessTraceViewModel;
  result?: TaskResultViewModel;
  planId?: string;
  planStatus?: PlanStatus;
}

export type MessageStreamItem =
  | UserPromptBubbleViewModel
  | TaskWorkstreamViewModel
  | UserConfirmationViewModel
  | UserRevisionViewModel;

export interface ProgressPanelViewModel {
  current: ProgressTask[];
  history: ProgressTask[];
}

export interface ArtifactsPanelViewModel {
  current: WorkstreamArtifactRecord[];
  previous: WorkstreamArtifactRecord[];
}

export interface ContextPanelGroupViewModel {
  kind: ContextKind;
  important: WorkstreamContextRecord[];
  all: WorkstreamContextRecord[];
}

export interface ContextPanelViewModel {
  groups: ContextPanelGroupViewModel[];
}

export interface RightPanelViewModel {
  progress: ProgressPanelViewModel;
  artifacts: ArtifactsPanelViewModel;
  context: ContextPanelViewModel;
}

export interface ComposerApprovalViewModel {
  planId: string;
  runId?: string;
  workstreamId: string;
  status: PlanStatus;
  title: string;
  summary: string;
  canApprove: boolean;
  canRequestRevision: boolean;
}

export interface BranchNavigatorViewModel {
  activeBranchId: string;
  branchIndex: number;
  branchCount: number;
  branches: RequestBranch[];
}

export interface AgentWorkstreamPresentation {
  sessionId: string;
  activeBranchId: string;
  mode: AppMode;
  items: MessageStreamItem[];
  rightPanel: RightPanelViewModel;
  approval?: ComposerApprovalViewModel | null;
  branchNavigator?: BranchNavigatorViewModel | null;
  rawAuditRefs: RawAuditRef[];
  updatedAt: string;
}

export interface WorkstreamSessionResult {
  success: boolean;
  session?: AgentWorkstreamSession;
  presentation?: AgentWorkstreamPresentation;
  error?: string;
}

export interface WorkstreamRevisionResult extends WorkstreamSessionResult {
  runId?: string;
  planId?: string;
  branchId?: string;
}

export interface WorkstreamBranchSwitchResult extends WorkstreamSessionResult {
  activeBranchId?: string;
}

export interface WorkstreamExportOptions {
  includeRawTrace?: boolean;
  includeAllBranches?: boolean;
}

export interface WorkstreamExportResult {
  success: boolean;
  sessionId?: string;
  summaryPath?: string;
  rawTracePath?: string;
  bundlePath?: string;
  error?: string;
}

