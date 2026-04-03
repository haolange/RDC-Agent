/**
 * Session Types - Session 控制面板相关类型定义
 */

import type { ReplayDeviceEntry } from './device';

export type AppMode = 'debugger' | 'analyzer' | 'optimizer';

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
  createdAt: number;
  updatedAt: number;
  lastRunId?: string;
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
  mode: AppMode;
  goal: string;
  captures: CaptureDescriptor[];
  primaryCaptureId: string;
  replayDevice: ReplayDeviceEntry;
}

export interface RunRecord {
  runId: string;
  projectId: string;
  sessionId: string;
  caseId: string;
  mode: AppMode;
  goal: string;
  captures: CaptureDescriptor[];
  startedAt: number;
  finishedAt?: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  lastStage: string;
  backend: 'local' | 'remote';
}

export type RunSummary = RunRecord;

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
}

export interface OpenedCaptureState {
  projectId: string;
  inputId: string;
  filePath: string;
  captureId: string;
  sessionId: string;
  contextId: string;
  replaySessionId: string;
  backend: 'local' | 'remote';
  deviceId: string;
  deviceLabel: string;
  status: 'opening' | 'open' | 'error' | 'closed';
  openedAt: number;
}

export interface OpenProjectInputRequest {
  projectId: string;
  inputId: string;
  filePath: string;
  replayDevice: ReplayDeviceEntry;
}
