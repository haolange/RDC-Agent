import type {
  InvestigationArtifactKind,
  InvestigationArtifactStatus,
  InvestigationMission,
  InvestigationRecordType,
} from './renderdocInvestigation';
import type { ConversationTaskStatus, TaskDisplayState } from './conversation';
import type {
  TaskDependencyWait,
  TaskExecutionDispatch,
  TaskExecutionPreparation,
  TaskExecutionStatus,
} from './taskExecution';

export interface RawAuditRef {
  id: string;
  label: string;
  eventId?: string;
  runId?: string;
  sessionId?: string;
  ref?: string;
}

/** Facts from a Task's current execution record, shown beside the Task; never inferred from text. */
export interface TaskExecutionFacts {
  mode: 'direct' | 'subagent' | 'handoff';
  status: TaskExecutionStatus;
  dispatch?: TaskExecutionDispatch;
  /** The Agent that actually ran the execution, from its prepared runtime facts. */
  agentId?: string;
  model?: { providerId: string; modelId: string; reasoningLevel?: TaskExecutionPreparation['reasoningLevel'] };
}

/** One Task as the session right rail shows it, projected by main from TaskRegistry. */
export interface TaskRailItem {
  id: string;
  sessionId: string;
  traceLaneId: string;
  branchId: string;
  title: string;
  status: ConversationTaskStatus;
  displayState: TaskDisplayState;
  execution?: TaskExecutionFacts;
  order: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  linkedEventIds?: string[];
  blockerSummary?: string;
  waitingOn?: TaskDependencyWait[];
}

type TraceArtifactType =
  'report' | 'generative_ui' | 'visual_report' | 'evidence_bundle' | 'failure_summary' | 'cancelled_summary' | 'other';

export type TraceArtifactSource = 'report' | 'evidence' | 'image' | 'document' | 'data' | 'other';

type ArtifactStatus = 'draft' | 'ready' | 'failed' | 'superseded';

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

type RequestBranchStatus = 'active' | 'inactive' | 'abandoned' | 'completed';

export interface RequestBranch {
  id: string;
  parentBranchId?: string;
  revisionId: string;
  status: RequestBranchStatus;
  traceLaneIds: string[];
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
  totalCount: number;
  storeDegraded: boolean;
}

type TaskContextResourceKind = 'attachment' | 'reference' | 'file' | 'directory' | 'skill' | 'mcp' | 'web';

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

export interface RdcContextCaptureInput {
  inputId: string;
  fileName: string;
  filePath: string;
  sizeBytes: number;
}

interface RdcContextCaptureViewModel {
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

interface RdcContextRuntimeViewModel {
  contextId?: string;
  replaySessionId?: string;
  runtimeOwner?: string;
  ownerLeaseId?: string;
  remoteId?: string;
  remoteStatus?: 'connected' | 'online' | 'disconnected' | 'error';
}

export interface RdcContextDiagnostic {
  id: string;
  code?: string;
  summary: string;
  detail?: string;
  repeatCount: number;
  action: 'retry' | 'change_device' | 'copy' | 'settings' | 'none';
}

export interface RdcContextPanelViewModel {
  capture: RdcContextCaptureViewModel | null;
  availableCaptures: RdcContextCaptureInput[];
  runtime: RdcContextRuntimeViewModel;
  diagnostics: RdcContextDiagnostic[];
}

export interface ContextPanelViewModel {
  task: TaskContextPanelViewModel;
  rdc: RdcContextPanelViewModel;
}

export interface RightPanelViewModel {
  tasks: TaskRailItem[];
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

/** Read-only pages of the same current Investigation selection used by the rail. */
export interface InvestigationListCursor {
  createdAt: string;
  artifactId: string;
}
export interface InvestigationListRequest {
  projectId: string;
  sessionId: string;
  cursor?: InvestigationListCursor;
}
export interface InvestigationListPage extends InvestigationArtifactsPanelViewModel {
  nextCursor?: InvestigationListCursor;
}
