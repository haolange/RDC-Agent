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

export interface TraceExportOptions {
  includeRawTrace?: boolean;
  includeAllBranches?: boolean;
}

export interface TraceExportResult {
  success: boolean;
  sessionId?: string;
  summaryPath?: string;
  rawTracePath?: string;
  bundlePath?: string;
  error?: string;
}
