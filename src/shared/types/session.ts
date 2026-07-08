/**
 * Session Types - Session 控制面板相关类型定义
 */

import type { ConversationTurnControls } from './modelCapability';
import type { ReplayDeviceEntry } from './device';

export type ExecutableAppMode = 'debugger' | 'analyzer' | 'optimizer';
export type AppMode = 'ask' | 'edit' | ExecutableAppMode;

export interface ProjectInputRecord {
  inputId: string;
  fileName: string;
  filePath: string;
  source: 'project_resource';
  discoveredAt: number;
  lastModifiedAt: number;
  size: number;
}

export interface ProjectRecord {
  projectId: string;
  name: string;
  rootPath: string;
  slug: string;
  resourcePath: string;
  knowledgePath: string;
  inputsPath: string;
  inputs: ProjectInputRecord[];
  inputsUpdatedAt: number;
  createdAt: number;
  updatedAt: number;
  lastSessionId?: string;
}

export interface SessionRecord {
  sessionId: string;
  projectId: string;
  title: string;
  goal: string;
  sessionPath: string;
  createdAt: number;
  updatedAt: number;
  lastRunId?: string;
  turnControls?: ConversationTurnControls;
}

export type SessionAttachmentKind = 'image' | 'file';

export interface SessionAttachmentRecord {
  attachmentId: string;
  sessionId: string;
  projectId: string;
  kind: SessionAttachmentKind;
  fileName: string;
  filePath: string;
  mimeType: string;
  size: number;
  createdAt: number;
}

export type SessionOutputKind = 'attachment' | 'artifact' | 'report' | 'action_artifact';

export interface SessionOutputRecord {
  id: string;
  kind: SessionOutputKind;
  title: string;
  fileName: string;
  filePath: string;
  source: string;
  runId?: string;
  mimeType?: string;
  sizeBytes?: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface RunReportPaths {
  reportsDir: string;
  markdownPath?: string;
  jsonPath?: string;
  htmlPath?: string;
}

export interface CaptureInfo {
  id: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  capturedAt: number;
  deviceId?: string;
}

export interface CaptureControl {
  captures: CaptureInfo[];
  activeCapture: string | null;
  isLoading: boolean;
}

export interface SessionContext {
  sessionId: string | null;
  caseId: string | null;
  startedAt: number | null;
  deviceId: string | null;
  replayContext: string | null;
  captureControl: CaptureControl;
}

export type CaptureRole = 'primary' | 'baseline' | 'reference' | 'fix';

export type ReplayBackendHint = 'local' | 'remote';

export interface CaptureDescriptor {
  id: string;
  filePath: string;
  captureFileId?: string;
  role: CaptureRole;
  backendHint: ReplayBackendHint;
  status: 'pending' | 'opening' | 'open' | 'error' | 'closed';
  ownerSessionId?: string | null;
  sessionId?: string;
  replaySessionId?: string;
  contextId?: string;
}

export interface DebugSessionStartRequest {
  projectId: string;
  sessionId?: string;
  turnId?: string;
  mode: ExecutableAppMode;
  goal: string;
  captures?: CaptureDescriptor[];
  primaryCaptureId?: string;
  replayDevice?: ReplayDeviceEntry | null;
}

export interface RunRecord {
  runId: string;
  turnId?: string;
  projectId: string;
  sessionId: string;
  caseId: string;
  mode: ExecutableAppMode;
  goal: string;
  captures: CaptureDescriptor[];
  startedAt: number;
  finishedAt?: number;
  stoppedAt?: number;
  status:
    | 'queued'
    | 'planning'
    | 'awaiting_input'
    | 'awaiting_approval'
    | 'running'
    | 'stopping'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'interrupted';
  stopReason?: string;
  lastStage: string;
  backend: 'local' | 'remote';
  reportPaths?: RunReportPaths;
}

export type RunSummary = RunRecord;

export type ContextUsageBreakdownId =
  | 'system_prompt'
  | 'rules'
  | 'memory_files'
  | 'system_tools'
  | 'mcp_tools'
  | 'subagent_definitions'
  | 'summarized_conversation'
  | 'conversation'
  | 'free';

export interface ContextUsageBreakdownEntry {
  id: ContextUsageBreakdownId;
  tokens: number;
  /** 可选附加计数，如工具数量、消息条数。 */
  count?: number;
}

export interface RunContextUsageSummary {
  runId: string;
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextWindowTokens: number | null;
  usagePercent: number;
  /** 最近一次 LLM 请求的 prompt 占用量（=provider 上报的 inputTokens），用于窗口占用率。 */
  occupiedTokens: number;
  /** 最近一次 prompt 的分类 token 估算；无 run 数据时为 null。 */
  breakdown: ContextUsageBreakdownEntry[] | null;
  /** 最近一次用量快照时间戳。 */
  snapshotAt: number | null;
}

export interface HumanPreviewSnapshot {
  status: 'unavailable' | 'closed' | 'opening' | 'open' | 'error';
  sessionId?: string;
  boundEventId?: number;
  lastError?: string;
  updatedAt: number;
}

export interface RdxRuntimeContext {
  contextId: string;
  runtimeOwner: string;
  ownerLeaseId: string;
  replaySessionId?: string;
  captureFileId?: string;
  captureId?: string;
  backend: 'local' | 'remote';
  deviceId?: string;
  deviceLabel?: string;
  remoteId?: string;
  remoteStatus?: 'connected' | 'online' | 'disconnected' | 'error';
  updatedAt: number;
  raw?: Record<string, unknown>;
}

export interface ContextSnapshot {
  contextId: string;
  sessionId: string;
  ownerSessionId?: string | null;
  backend: 'local' | 'remote';
  remoteStatus?: 'connected' | 'online' | 'disconnected' | 'error';
  runtimeOwner: string;
  ownerLeaseId: string;
  captureDescriptors: CaptureDescriptor[];
  activeCapture: string;
  deviceLabel: string;
  humanPreview?: HumanPreviewSnapshot;
  runtimeContext?: RdxRuntimeContext | null;
}

export interface OpenedCapturePreview {
  imagePath: string;
  imageUrl: string;
  width: number;
  height: number;
  source: 'framebuffer_screenshot' | 'capture_thumbnail';
  resolvedEventId?: number;
  presentEventId?: number;
  textureId?: string;
  targetSource?: string;
  targetSemantic?: string;
  fallbackReason?: string;
  summaryDegraded?: boolean;
  updatedAt: number;
}

export interface OpenedCapturePreviewAttempt {
  source: OpenedCapturePreview['source'];
  status: 'success' | 'failed';
  eventId?: number;
  message?: string;
  code?: string;
  imagePath?: string;
  resolvedEventId?: number;
  presentEventId?: number;
  textureId?: string;
  targetSource?: string;
  targetSemantic?: string;
  fallbackReason?: string;
  details?: unknown;
}

export interface OpenedCapturePreviewError {
  message: string;
  code?: string;
  attempts: OpenedCapturePreviewAttempt[];
}

export interface OpenedCaptureState {
  projectId: string;
  ownerSessionId: string | null;
  inputId: string;
  filePath: string;
  captureId: string;
  captureFileId?: string;
  sessionId: string;
  contextId: string;
  replaySessionId: string;
  backend: 'local' | 'remote';
  deviceId: string;
  deviceLabel: string;
  status: 'opening' | 'open' | 'error' | 'closed';
  openedAt: number;
  preview?: OpenedCapturePreview | null;
  previewError?: OpenedCapturePreviewError | null;
  previewAttempts?: OpenedCapturePreviewAttempt[];
  runtimeContext?: RdxRuntimeContext | null;
}

export interface OpenProjectInputRequest {
  projectId: string;
  ownerSessionId: string | null;
  inputId: string;
  filePath: string;
  replayDevice: ReplayDeviceEntry;
}
