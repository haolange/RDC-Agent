export type PlanStatus =
  | 'draft'
  | 'awaiting_approval'
  | 'accepted'
  | 'needs_revision'
  | 'superseded'
  | 'executed'
  | 'failed';

export interface RawAuditRef {
  id: string;
  label: string;
  eventId?: string;
  runId?: string;
  sessionId?: string;
  ref?: string;
}

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
  traceLaneId: string;
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
  /** 进行中（running）时展示的动名词描述，用于「当前步骤」文案。 */
  activeForm?: string;
}

export type TraceArtifactType =
  | 'plan'
  | 'report'
  | 'generative_ui'
  | 'visual_report'
  | 'evidence_bundle'
  | 'failure_summary'
  | 'cancelled_summary'
  | 'other';

export type ArtifactStatus = 'draft' | 'ready' | 'failed' | 'superseded';

export interface TraceArtifactRecord {
  id: string;
  sessionId: string;
  traceLaneId: string;
  branchId: string;
  sourceEventId?: string;
  type: TraceArtifactType;
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

export interface TraceContextRecord {
  id: string;
  sessionId: string;
  traceLaneId?: string;
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

export interface UserRequestRevision {
  id: string;
  requestId: string;
  branchId: string;
  parentRevisionId?: string;
  prompt: string;
  createdAt: string;
  resultingTraceLaneIds: string[];
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
  traceLaneIds: string[];
}

export interface RequestBranchGroup {
  id: string;
  rootRequestId: string;
  activeBranchId: string;
  branches: RequestBranch[];
}

export interface ProgressPanelViewModel {
  current: ProgressTask[];
  history: ProgressTask[];
}

export interface ArtifactsPanelViewModel {
  current: TraceArtifactRecord[];
  previous: TraceArtifactRecord[];
}

export interface ContextPanelGroupViewModel {
  kind: ContextKind;
  important: TraceContextRecord[];
  all: TraceContextRecord[];
}

export interface ContextPanelViewModel {
  groups: ContextPanelGroupViewModel[];
}

export interface RightPanelViewModel {
  progress: ProgressPanelViewModel;
  artifacts: ArtifactsPanelViewModel;
  context: ContextPanelViewModel;
}

export interface BranchNavigatorViewModel {
  activeBranchId: string;
  branchIndex: number;
  branchCount: number;
  branches: RequestBranch[];
}

export interface TraceSessionResult {
  success: boolean;
  presentation?: import('./agenticTrace').AgentRunPresentation;
  error?: string;
}

export interface TraceRevisionResult extends TraceSessionResult {
  runId?: string;
  planId?: string;
  branchId?: string;
}

export interface TraceBranchSwitchResult extends TraceSessionResult {
  activeBranchId?: string;
}

