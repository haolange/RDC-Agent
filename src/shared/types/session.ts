/**
 * Session Types - Session 控制面板相关类型定义
 */

import type { ReplayDeviceEntry } from './device';

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
  mode: 'debugger' | 'analyzer' | 'optimizer';
  goal: string;
  captures: CaptureDescriptor[];
  primaryCaptureId: string;
  replayDevice: ReplayDeviceEntry;
}

export interface RunSummary {
  runId: string;
  caseId: string;
  sessionId: string;
  mode: 'debugger' | 'analyzer' | 'optimizer';
  goal: string;
  captures: CaptureDescriptor[];
  startedAt: number;
  finishedAt?: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  lastStage: string;
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
}
