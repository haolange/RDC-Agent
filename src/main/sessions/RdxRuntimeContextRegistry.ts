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

function cloneRuntimeContext(runtimeContext: RdxRuntimeContext): RdxRuntimeContext {
  return {
    ...runtimeContext,
    raw: runtimeContext.raw ? { ...runtimeContext.raw } : undefined,
  };
}

/**
 * Bind or clear a per-session RDX context lease.
 * Empty sessionId is fail-closed (returns null; does not write any global mirror).
 */
export function setRdxRuntimeContextForSession(
  sessionId: string,
  runtimeContext: RdxRuntimeContext | null,
  options?: { projectId?: string | null },
): RdxContextLease | null {
  const trimmed = sessionId.trim();
  if (!trimmed) {
    return null;
  }
  if (!runtimeContext) {
    leasesBySession.delete(trimmed);
    return null;
  }
  versionSeq += 1;
  const lease: RdxContextLease = {
    contextId: runtimeContext.contextId,
    version: versionSeq,
    ownerSessionId: trimmed,
    ownerProjectId: options?.projectId ?? null,
    captureHash: computeCaptureHash(runtimeContext),
    runtimeContext: cloneRuntimeContext(runtimeContext),
    updatedAt: Date.now(),
  };
  leasesBySession.set(trimmed, lease);
  return lease;
}

export function getRdxContextLease(sessionId: string | null | undefined): RdxContextLease | null {
  if (!sessionId) return null;
  const lease = leasesBySession.get(sessionId);
  if (!lease) return null;
  return {
    ...lease,
    runtimeContext: cloneRuntimeContext(lease.runtimeContext),
  };
}

/**
 * UI / no-session summary helper: pick the most recently updated lease.
 * Tools must still use assertRdxContextLeaseOwnership with an explicit sessionId.
 */
export function getMostRecentRdxContextLease(): RdxContextLease | null {
  let latest: RdxContextLease | null = null;
  for (const sessionId of listRdxContextLeaseSessionIds()) {
    const lease = getRdxContextLease(sessionId);
    if (!lease) continue;
    if (!latest || lease.updatedAt > latest.updatedAt) {
      latest = lease;
    }
  }
  return latest;
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
  versionSeq = 0;
}

export function listRdxContextLeaseSessionIds(): string[] {
  return Array.from(leasesBySession.keys());
}
