import { ipcMain } from 'electron';
import type { InvestigationReadIpcResult } from '@shared/types/renderdocInvestigation';
import { SessionArtifactError } from '@shared/types/sessionArtifact';
import { InvestigationError, isInvestigationStoreDegraded } from '../investigation/investigationErrors';
import { investigationArtifactService } from '../investigation/InvestigationArtifactService';
import { storageAdapter } from '../sessions/StorageAdapter';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import { InvestigationReadArgsSchema } from './validation/investigationSchemas';
import type { WorkbenchIpcContext, WorkbenchIpcState } from './workbenchContext';

function sessionDenied(message: string): InvestigationReadIpcResult {
  return {
    ok: false,
    status: 'error',
    errorCode: 'INVESTIGATION_SESSION_DENIED',
    error: message,
  };
}

function assertActiveInvestigationOwner(
  state: WorkbenchIpcState,
  sessionId: string,
): InvestigationReadIpcResult | null {
  if (!state.currentSessionId || sessionId !== state.currentSessionId) {
    return sessionDenied('investigation:read requires the active session');
  }
  const session = storageAdapter.readSession(sessionId);
  if (!session) {
    return sessionDenied('investigation:read session was not found');
  }
  if (!state.currentProjectId || session.projectId !== state.currentProjectId) {
    return sessionDenied('investigation:read requires the active project owner');
  }
  return null;
}

function mapInvestigationReadError(error: unknown): InvestigationReadIpcResult {
  if (error instanceof SessionArtifactError && error.code === 'ARTIFACT_TOO_LARGE') {
    return {
      ok: false,
      status: 'error',
      errorCode: error.code,
      error: error.message,
    };
  }
  if (error instanceof InvestigationError) {
    if (error.code === 'INVESTIGATION_HASH_MISMATCH') {
      return { ok: false, status: 'hash-mismatch', errorCode: error.code, error: error.message };
    }
    if (isInvestigationStoreDegraded(error)) {
      return { ok: false, status: 'degraded', errorCode: error.code, error: error.message };
    }
    if (error.details?.artifactCode === 'ARTIFACT_TOO_LARGE') {
      return {
        ok: false,
        status: 'error',
        errorCode: 'ARTIFACT_TOO_LARGE',
        error: error.message,
      };
    }
    return { ok: false, status: 'error', errorCode: error.code, error: error.message };
  }
  return {
    ok: false,
    status: 'error',
    errorCode: 'INVESTIGATION_STORAGE_FAILED',
    error: error instanceof Error ? error.message : String(error),
  };
}

export function registerInvestigationHandlers(context: WorkbenchIpcContext): void {
  ipcMain.handle('investigation:read', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(InvestigationReadArgsSchema, rawArgs, {
      label: 'investigation:read',
      maxBytes: 4 * 1024,
    });
    const denied = assertActiveInvestigationOwner(context.state, request.sessionId);
    if (denied) return denied;
    try {
      const result = investigationArtifactService.readRecord(
        request.sessionId,
        request.artifactId,
        request.expectedHash,
      );
      return {
        ok: true,
        status: 'ready',
        manifest: result.manifest,
        record: result.record,
        contentHash: result.contentHash,
      } satisfies InvestigationReadIpcResult;
    } catch (error) {
      return mapInvestigationReadError(error);
    }
  });
}
