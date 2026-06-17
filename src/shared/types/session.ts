/**
 * Session Types - Session 控制面板相关类型定义
 */

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

export interface RunContextUsageSummary {
  runId: string;
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextWindowTokens: number | null;
  usagePercent: number;
  hasConfiguredContextWindow: boolean;
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
  inputId: string;
  filePath: string;
  replayDevice: ReplayDeviceEntry;
}
