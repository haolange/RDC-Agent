/**
 * Per-session RDX context leases. Tools must verify ownership before reading.
 */

import { createHash } from 'crypto';
import type { RdxRuntimeContext } from '@shared/types/session';

export interface RdxContextLease {
  contextId: string;
  version: number;
  ownerSessionId: string;
  ownerProjectId: string | null;
  captureHash: string | null;
  runtimeContext: RdxRuntimeContext;
  updatedAt: number;
}

const leasesBySession = new Map<string, RdxContextLease>();
/** @deprecated Prefer per-session lease; kept only as last-writer mirror for UI summary without session. */
let legacyGlobalMirror: RdxRuntimeContext | null = null;
let versionSeq = 0;

function computeCaptureHash(runtimeContext: RdxRuntimeContext): string | null {
  const captureKey =
    runtimeContext.captureFileId
    ?? runtimeContext.captureId
    ?? runtimeContext.replaySessionId
    ?? null;
  if (!captureKey) return null;
  return createHash('sha256').update(captureKey).digest('hex').slice(0, 16);
}

export function setRdxRuntimeContextForSession(
  sessionId: string,
  runtimeContext: RdxRuntimeContext | null,
  options?: { projectId?: string | null },
): RdxContextLease | null {
  if (!sessionId) {
    setRdxRuntimeContext(runtimeContext);
    return null;
  }
  if (!runtimeContext) {
    leasesBySession.delete(sessionId);
    if (legacyGlobalMirror) {
      // Clear mirror only when no other leases remain.
      if (leasesBySession.size === 0) {
        legacyGlobalMirror = null;
      }
    }
    return null;
  }
  versionSeq += 1;
  const lease: RdxContextLease = {
    contextId: runtimeContext.contextId,
    version: versionSeq,
    ownerSessionId: sessionId,
    ownerProjectId: options?.projectId ?? null,
    captureHash: computeCaptureHash(runtimeContext),
    runtimeContext: { ...runtimeContext, raw: runtimeContext.raw ? { ...runtimeContext.raw } : undefined },
    updatedAt: Date.now(),
  };
  leasesBySession.set(sessionId, lease);
  legacyGlobalMirror = lease.runtimeContext;
  return lease;
}

/**
 * Legacy global setter — used by RdxSessionService until callers pass sessionId.
 * When sessionId is unknown, stores only the mirror (tools requiring ownership fail-closed).
 */
export function setRdxRuntimeContext(runtimeContext: RdxRuntimeContext | null): void {
  legacyGlobalMirror = runtimeContext
    ? { ...runtimeContext, raw: runtimeContext.raw ? { ...runtimeContext.raw } : undefined }
    : null;
}

export function getRdxRuntimeContext(): RdxRuntimeContext | null {
  return legacyGlobalMirror
    ? { ...legacyGlobalMirror, raw: legacyGlobalMirror.raw ? { ...legacyGlobalMirror.raw } : undefined }
    : null;
}

export function getRdxContextLease(sessionId: string | null | undefined): RdxContextLease | null {
  if (!sessionId) return null;
  const lease = leasesBySession.get(sessionId);
  if (!lease) return null;
  return {
    ...lease,
    runtimeContext: {
      ...lease.runtimeContext,
      raw: lease.runtimeContext.raw ? { ...lease.runtimeContext.raw } : undefined,
    },
  };
}

/**
 * Verify that the calling session owns the lease for the requested context.
 * Fail-closed: missing session or mismatched ownership returns null.
 */
export function assertRdxContextLeaseOwnership(input: {
  sessionId?: string | null;
  contextId?: string | null;
  projectId?: string | null;
}): RdxContextLease | null {
  const sessionId = input.sessionId?.trim();
  if (!sessionId) return null;
  const lease = leasesBySession.get(sessionId);
  if (!lease) return null;
  if (lease.ownerSessionId !== sessionId) return null;
  if (input.contextId && lease.contextId !== input.contextId) return null;
  if (
    input.projectId
    && lease.ownerProjectId
    && lease.ownerProjectId !== input.projectId
  ) {
    return null;
  }
  return getRdxContextLease(sessionId);
}

export function clearRdxContextLeases(): void {
  leasesBySession.clear();
  legacyGlobalMirror = null;
  versionSeq = 0;
}

export function listRdxContextLeaseSessionIds(): string[] {
  return Array.from(leasesBySession.keys());
}
