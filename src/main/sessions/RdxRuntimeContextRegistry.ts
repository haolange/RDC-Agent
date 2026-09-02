/**
 * Per-session RDX context leases. Tools must verify ownership before reading.
 * Parent sessions may grant one scoped, lifecycle-bound delegated lease to a child.
 */

import { createHash } from 'crypto';
import type { RdxRuntimeContext } from '@shared/types/session';

export const RDX_LEASE_DELEGATE_DENIED = 'RDX_LEASE_DELEGATE_DENIED';
export const RDX_LEASE_DUAL_OWNER = 'RDX_LEASE_DUAL_OWNER';

export interface RdxContextLease {
  contextId: string;
  version: number;
  ownerSessionId: string;
  ownerProjectId: string | null;
  captureHash: string | null;
  runtimeContext: RdxRuntimeContext;
  updatedAt: number;
  /** Parent session id when this lease is a delegated copy. Independent leases omit it. */
  delegatedFrom?: string;
  /** Parent turn that owns the delegated grant. */
  ownerTurnId?: string;
}

export interface GrantDelegatedLeaseInput {
  parentSessionId: string;
  childSessionId: string;
  projectId?: string | null;
  ownerTurnId: string;
}

const leasesBySession = new Map<string, RdxContextLease>();
/** At most one live delegated child per parent. */
const delegatedChildByParent = new Map<string, string>();
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
    const existing = leasesBySession.get(trimmed);
    const delegatedChild = delegatedChildByParent.get(trimmed);
    if (delegatedChild) {
      revokeDelegatedLease(delegatedChild);
    }
    if (existing?.delegatedFrom && delegatedChildByParent.get(existing.delegatedFrom) === trimmed) {
      delegatedChildByParent.delete(existing.delegatedFrom);
    }
    leasesBySession.delete(trimmed);
    return null;
  }
  const existing = leasesBySession.get(trimmed);
  if (existing?.delegatedFrom) {
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
 * Does not fall back to a parent session.
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
  if (input.projectId !== undefined && lease.ownerProjectId !== input.projectId) {
    return null;
  }
  return getRdxContextLease(sessionId);
}

function failDelegatedLease(code: string, detail: string): never {
  throw new Error(`${code}: ${detail}`);
}

/**
 * Copy the parent session's RDX context onto the child as a delegated lease.
 * Child leases are not transferable. Only one live delegated child per parent.
 */
export function grantDelegatedLease(input: GrantDelegatedLeaseInput): RdxContextLease {
  const parentSessionId = input.parentSessionId.trim();
  const childSessionId = input.childSessionId.trim();
  const ownerTurnId = input.ownerTurnId.trim();
  if (!parentSessionId) {
    failDelegatedLease(RDX_LEASE_DELEGATE_DENIED, 'parent session id is required.');
  }
  if (!childSessionId) {
    failDelegatedLease(RDX_LEASE_DELEGATE_DENIED, 'child session id is required.');
  }
  if (!ownerTurnId) {
    failDelegatedLease(RDX_LEASE_DELEGATE_DENIED, 'ownerTurnId is required.');
  }
  if (parentSessionId === childSessionId) {
    failDelegatedLease(RDX_LEASE_DELEGATE_DENIED, 'child session must be distinct from parent.');
  }

  const parentLease = leasesBySession.get(parentSessionId);
  if (!parentLease) {
    failDelegatedLease(RDX_LEASE_DELEGATE_DENIED, 'parent session has no RDX runtime context lease.');
  }
  if (parentLease.delegatedFrom) {
    failDelegatedLease(RDX_LEASE_DELEGATE_DENIED, 'child lease is not independently transferable.');
  }
  if (input.projectId != null && parentLease.ownerProjectId !== input.projectId) {
    failDelegatedLease(RDX_LEASE_DELEGATE_DENIED, 'projectId does not match the parent RDX lease.');
  }

  const existingChild = delegatedChildByParent.get(parentSessionId);
  if (existingChild && existingChild !== childSessionId && leasesBySession.has(existingChild)) {
    failDelegatedLease(RDX_LEASE_DUAL_OWNER, 'parent already has a live delegated RDX lease.');
  }

  const existingLease = leasesBySession.get(childSessionId);
  if (existingLease && !existingLease.delegatedFrom) {
    failDelegatedLease(RDX_LEASE_DELEGATE_DENIED, 'child session already holds an independent RDX lease.');
  }
  if (existingLease?.delegatedFrom && existingLease.delegatedFrom !== parentSessionId) {
    failDelegatedLease(RDX_LEASE_DELEGATE_DENIED, 'child session already holds a delegated RDX lease.');
  }

  versionSeq += 1;
  const lease: RdxContextLease = {
    contextId: parentLease.contextId,
    version: versionSeq,
    ownerSessionId: childSessionId,
    ownerProjectId: parentLease.ownerProjectId,
    captureHash: parentLease.captureHash,
    runtimeContext: cloneRuntimeContext(parentLease.runtimeContext),
    updatedAt: Date.now(),
    delegatedFrom: parentSessionId,
    ownerTurnId,
  };
  leasesBySession.set(childSessionId, lease);
  delegatedChildByParent.set(parentSessionId, childSessionId);
  return getRdxContextLease(childSessionId)!;
}

/** Remove a child's delegated binding. Parent lease is unchanged. */
export function revokeDelegatedLease(childSessionId: string): boolean {
  const trimmed = childSessionId.trim();
  if (!trimmed) return false;
  const lease = leasesBySession.get(trimmed);
  for (const [parent, child] of delegatedChildByParent) {
    if (child === trimmed) {
      delegatedChildByParent.delete(parent);
    }
  }
  if (!lease?.delegatedFrom) {
    return false;
  }
  leasesBySession.delete(trimmed);
  return true;
}

export function getDelegatedChildSessionId(parentSessionId: string): string | null {
  const trimmed = parentSessionId.trim();
  if (!trimmed) return null;
  const child = delegatedChildByParent.get(trimmed);
  if (!child || !leasesBySession.has(child)) return null;
  return child;
}

export function clearRdxContextLeases(): void {
  leasesBySession.clear();
  delegatedChildByParent.clear();
  versionSeq = 0;
}

export function listRdxContextLeaseSessionIds(): string[] {
  return Array.from(leasesBySession.keys());
}
