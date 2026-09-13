import type {
  InvestigationArtifactKind,
  InvestigationArtifactStatus,
  InvestigationMission,
  InvestigationRecordType,
} from './renderdocInvestigation';

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
  | 'in_progress'
  | 'completed'
  | 'blocked'
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
  linkedEventIds?: string[];
  blockerSummary?: string;
}

export type TraceArtifactType =
  | 'report'
  | 'generative_ui'
  | 'visual_report'
  | 'evidence_bundle'
  | 'failure_summary'
  | 'cancelled_summary'
  | 'other';

export type TraceArtifactSource = 'report' | 'evidence' | 'image' | 'document' | 'data' | 'other';

export type ArtifactStatus = 'draft' | 'ready' | 'failed' | 'superseded';

export interface TraceArtifactRecord {
  id: string;
  sessionId: string;
  traceLaneId: string;
  branchId: string;
  sourceEventId?: string;
  /** User-facing category. Internal stores and report producers are not part of the UI contract. */
  source: TraceArtifactSource;
  /** The producing run when one exists. */
  runId?: string;
  type: TraceArtifactType;
  status: ArtifactStatus;
  displayName: string;
  taskTitle?: string;
  path?: string;
  uri?: string;
  mimeType?: string;
  sizeBytes?: number;
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

export interface OutputsPanelViewModel {
  current: TraceArtifactRecord[];
  previous: TraceArtifactRecord[];
}

export interface InvestigationArtifactRow {
  artifactId: string;
  kind: InvestigationArtifactKind;
  recordType: InvestigationRecordType;
  status: InvestigationArtifactStatus;
  mission: InvestigationMission | 'unknown';
  title: string;
  createdAt: string;
  contentHash: string;
  contentHashShort: string;
  sourceRefCount: number;
  worldStateId?: string;
  degraded: boolean;
}

export interface InvestigationArtifactsPanelViewModel {
  rows: InvestigationArtifactRow[];
  supersededCount: number;
  truncatedCount: number;
  storeDegraded: boolean;
}

export type TaskContextResourceKind =
  | 'attachment'
  | 'reference'
  | 'file'
  | 'directory'
  | 'skill'
  | 'mcp'
  | 'web';

export interface TaskContextResource {
  id: string;
  kind: TaskContextResourceKind;
  label: string;
  summary?: string;
  state?: 'active' | 'preloaded' | 'used' | 'available';
  path?: string;
  url?: string;
}

export interface TaskContextPanelViewModel {
  projectId: string;
  projectName: string;
  sessionId: string;
  sessionTitle: string;
  workingDirectory: string;
  configurationPhase: 'current_turn' | 'next_turn';
  agentProfile: string;
  permission: string;
  resources: TaskContextResource[];
}

export interface RdxContextCaptureInput {
  inputId: string;
  fileName: string;
  filePath: string;
  sizeBytes: number;
}

export interface RdxContextCaptureViewModel {
  inputId: string;
  captureId?: string;
  captureFileId?: string;
  displayName: string;
  filePath: string;
  status: 'opening' | 'open' | 'error' | 'closed';
  backend: 'local' | 'remote';
  deviceLabel: string;
  replaySessionId?: string;
  openedAt?: string;
  previewAvailable: boolean;
}

export interface RdxContextRuntimeViewModel {
  contextId?: string;
  replaySessionId?: string;
  runtimeOwner?: string;
  ownerLeaseId?: string;
  remoteId?: string;
  remoteStatus?: 'connected' | 'online' | 'disconnected' | 'error';
}

export interface RdxContextDiagnostic {
  id: string;
  code?: string;
  summary: string;
  detail?: string;
  repeatCount: number;
  action: 'retry' | 'change_device' | 'copy' | 'settings' | 'none';
}

export interface RdxContextPanelViewModel {
  capture: RdxContextCaptureViewModel | null;
  availableCaptures: RdxContextCaptureInput[];
  runtime: RdxContextRuntimeViewModel;
  diagnostics: RdxContextDiagnostic[];
}

export interface ContextPanelViewModel {
  task: TaskContextPanelViewModel;
  rdx: RdxContextPanelViewModel;
}

export interface RightPanelViewModel {
  progress: ProgressTask[];
  artifacts: InvestigationArtifactsPanelViewModel;
  outputs: OutputsPanelViewModel;
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
