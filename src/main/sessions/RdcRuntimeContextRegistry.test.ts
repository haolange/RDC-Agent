import { describe, it, expect, beforeEach } from 'vitest';
import {
  setRdcRuntimeContextForSession,
  getRdcContextLease,
  assertRdcContextLeaseOwnership,
  clearRdcContextLeases,
  getMostRecentRdcContextLease,
  listRdcContextLeaseSessionIds,
  grantDelegatedLease,
  revokeDelegatedLease,
  getDelegatedChildSessionId,
  RDC_LEASE_DELEGATE_DENIED,
  RDC_LEASE_DUAL_OWNER,
  quarantineRdcContext,
} from './RdcRuntimeContextRegistry';
import type { RdcRuntimeContext } from '@shared/types/session';

function ctx(id: string, extras?: Partial<RdcRuntimeContext>): RdcRuntimeContext {
  return {
    contextId: id,
    runtimeOwner: 'local',
    ownerLeaseId: `lease:${id}`,
    backend: 'local',
    updatedAt: Date.now(),
    captureId: extras?.captureId ?? `cap-${id}`,
    ...extras,
  };
}

describe('RdcRuntimeContextRegistry leases', () => {
  beforeEach(() => {
    clearRdcContextLeases();
  });

  it('stores independent leases per session', () => {
    setRdcRuntimeContextForSession('s1', ctx('c1'), { projectId: 'p1' });
    setRdcRuntimeContextForSession('s2', ctx('c2'), { projectId: 'p2' });
    expect(getRdcContextLease('s1')?.contextId).toBe('c1');
    expect(getRdcContextLease('s2')?.contextId).toBe('c2');
    expect(getRdcContextLease('s1')?.ownerProjectId).toBe('p1');
  });

  it('assert ownership fail-closed without session', () => {
    setRdcRuntimeContextForSession('s1', ctx('c1'));
    expect(assertRdcContextLeaseOwnership({})).toBeNull();
    expect(assertRdcContextLeaseOwnership({ sessionId: 'other' })).toBeNull();
    expect(assertRdcContextLeaseOwnership({ sessionId: 's1', contextId: 'wrong' })).toBeNull();
    expect(assertRdcContextLeaseOwnership({ sessionId: 's1', contextId: 'c1' })?.contextId).toBe('c1');
    setRdcRuntimeContextForSession('scoped', ctx('scoped'), { projectId: 'project-a' });
    expect(assertRdcContextLeaseOwnership({ sessionId: 'scoped', projectId: 'project-b' })).toBeNull();
    expect(assertRdcContextLeaseOwnership({ sessionId: 'scoped', projectId: 'project-a' })?.contextId).toBe('scoped');
  });

  it('bumps version on update', () => {
    const a = setRdcRuntimeContextForSession('s1', ctx('c1'));
    const b = setRdcRuntimeContextForSession('s1', ctx('c1', { captureId: 'cap-2' }));
    expect(b!.version).toBeGreaterThan(a!.version);
    expect(getMostRecentRdcContextLease()?.contextId).toBe('c1');
  });

  it('fail-closes empty sessionId without writing a lease', () => {
    expect(setRdcRuntimeContextForSession('', ctx('c1'))).toBeNull();
    expect(setRdcRuntimeContextForSession('   ', ctx('c2'))).toBeNull();
    expect(listRdcContextLeaseSessionIds()).toEqual([]);
    expect(getMostRecentRdcContextLease()).toBeNull();
  });

  it('returns the most recently updated lease for UI summary', async () => {
    setRdcRuntimeContextForSession('s1', ctx('c1'));
    await new Promise((resolve) => setTimeout(resolve, 2));
    setRdcRuntimeContextForSession('s2', ctx('c2'));
    expect(getMostRecentRdcContextLease()?.contextId).toBe('c2');
    expect(listRdcContextLeaseSessionIds().sort()).toEqual(['s1', 's2']);
  });
});

describe('RdcRuntimeContextRegistry delegated leases', () => {
  beforeEach(() => {
    clearRdcContextLeases();
  });

  it('grants a child copy with delegatedFrom and leaves the parent unchanged', () => {
    setRdcRuntimeContextForSession('parent', ctx('c1', { captureId: 'cap-live' }), { projectId: 'p1' });
    const child = grantDelegatedLease({
      parentSessionId: 'parent',
      childSessionId: 'parent::subagent::child-1',
      projectId: 'p1',
      ownerTurnId: 'turn-1',
    });
    expect(child.delegatedFrom).toBe('parent');
    expect(child.ownerSessionId).toBe('parent::subagent::child-1');
    expect(child.ownerTurnId).toBe('turn-1');
    expect(child.runtimeContext.captureId).toBe('cap-live');
    expect(assertRdcContextLeaseOwnership({
      sessionId: 'parent::subagent::child-1',
      projectId: 'p1',
    })?.contextId).toBe('c1');
    expect(getRdcContextLease('parent')?.delegatedFrom).toBeUndefined();
    expect(getRdcContextLease('parent')?.ownerSessionId).toBe('parent');
  });

  it('fail-closes grant without a parent lease', () => {
    expect(() => grantDelegatedLease({
      parentSessionId: 'missing',
      childSessionId: 'child',
      ownerTurnId: 'turn-1',
    })).toThrow(new RegExp(RDC_LEASE_DELEGATE_DENIED));
    expect(getRdcContextLease('child')).toBeNull();
  });

  it('rejects a second live delegated child for the same parent', () => {
    setRdcRuntimeContextForSession('parent', ctx('c1'), { projectId: 'p1' });
    grantDelegatedLease({
      parentSessionId: 'parent',
      childSessionId: 'child-a',
      projectId: 'p1',
      ownerTurnId: 'turn-1',
    });
    expect(() => grantDelegatedLease({
      parentSessionId: 'parent',
      childSessionId: 'child-b',
      projectId: 'p1',
      ownerTurnId: 'turn-1',
    })).toThrow(new RegExp(RDC_LEASE_DUAL_OWNER));
    expect(getDelegatedChildSessionId('parent')).toBe('child-a');
    expect(getRdcContextLease('child-b')).toBeNull();
  });

  it('does not let a delegated child grant a grandchild', () => {
    setRdcRuntimeContextForSession('parent', ctx('c1'), { projectId: 'p1' });
    grantDelegatedLease({
      parentSessionId: 'parent',
      childSessionId: 'child',
      projectId: 'p1',
      ownerTurnId: 'turn-1',
    });
    expect(() => grantDelegatedLease({
      parentSessionId: 'child',
      childSessionId: 'grandchild',
      projectId: 'p1',
      ownerTurnId: 'turn-2',
    })).toThrow(/not independently transferable/);
    expect(getRdcContextLease('grandchild')).toBeNull();
  });

  it('revokes only the child lease', () => {
    setRdcRuntimeContextForSession('parent', ctx('c1'), { projectId: 'p1' });
    grantDelegatedLease({
      parentSessionId: 'parent',
      childSessionId: 'child',
      projectId: 'p1',
      ownerTurnId: 'turn-1',
    });
    expect(revokeDelegatedLease('child', { operationStopped: true })).toBe(true);
    expect(getRdcContextLease('child')).toBeNull();
    expect(assertRdcContextLeaseOwnership({ sessionId: 'child', projectId: 'p1' })).toBeNull();
    expect(getRdcContextLease('parent')?.contextId).toBe('c1');
    expect(getDelegatedChildSessionId('parent')).toBeNull();
  });

  it('allows a later grant after revoke', () => {
    setRdcRuntimeContextForSession('parent', ctx('c1'), { projectId: 'p1' });
    grantDelegatedLease({
      parentSessionId: 'parent',
      childSessionId: 'child-a',
      projectId: 'p1',
      ownerTurnId: 'turn-1',
    });
    revokeDelegatedLease('child-a', { operationStopped: true });
    const next = grantDelegatedLease({
      parentSessionId: 'parent',
      childSessionId: 'child-b',
      projectId: 'p1',
      ownerTurnId: 'turn-2',
    });
    expect(next.ownerSessionId).toBe('child-b');
    expect(getDelegatedChildSessionId('parent')).toBe('child-b');
  });

  it('does not fall back to the parent when asserting a child without a grant', () => {
    setRdcRuntimeContextForSession('parent', ctx('c1'), { projectId: 'p1' });
    expect(assertRdcContextLeaseOwnership({
      sessionId: 'parent::subagent::offline',
      projectId: 'p1',
    })).toBeNull();
  });
});

describe('exclusive delegated control and uncertain release', () => {
  beforeEach(clearRdcContextLeases);
  it('suspends parent operations and rebinding throughout the delegated interval', () => {
    setRdcRuntimeContextForSession('parent', ctx('c1'));
    grantDelegatedLease({ parentSessionId: 'parent', childSessionId: 'child', ownerTurnId: 't' });
    expect(assertRdcContextLeaseOwnership({ sessionId: 'parent' })).toBeNull();
    expect(assertRdcContextLeaseOwnership({ sessionId: 'child' })).not.toBeNull();
    expect(() => setRdcRuntimeContextForSession('parent', ctx('c2'))).toThrow(/join/);
    revokeDelegatedLease('child', { operationStopped: true });
    expect(assertRdcContextLeaseOwnership({ sessionId: 'parent' })).not.toBeNull();
  });
  it('does not return usable parent control when child exit is unconfirmed', () => {
    setRdcRuntimeContextForSession('parent', ctx('c1'));
    grantDelegatedLease({ parentSessionId: 'parent', childSessionId: 'child', ownerTurnId: 't' });
    revokeDelegatedLease('child', { operationStopped: false });
    expect(assertRdcContextLeaseOwnership({ sessionId: 'parent' })).toBeNull();
    expect(() => grantDelegatedLease({ parentSessionId: 'parent', childSessionId: 'next', ownerTurnId: 't2' })).toThrow(/recovery/);
  });
  it('late failed calls cannot quarantine a rebound identity', () => {
    const old = setRdcRuntimeContextForSession('s', ctx('c1'))!;
    const current = setRdcRuntimeContextForSession('s', ctx('c2'))!;
    quarantineRdcContext('s', old.version, 'late timeout');
    expect(assertRdcContextLeaseOwnership({ sessionId: 's' })?.version).toBe(current.version);
  });
});
