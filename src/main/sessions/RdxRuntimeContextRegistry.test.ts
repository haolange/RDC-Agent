import { describe, it, expect, beforeEach } from 'vitest';
import {
  setRdxRuntimeContextForSession,
  getRdxContextLease,
  assertRdxContextLeaseOwnership,
  clearRdxContextLeases,
  getMostRecentRdxContextLease,
  listRdxContextLeaseSessionIds,
  grantDelegatedLease,
  revokeDelegatedLease,
  getDelegatedChildSessionId,
  RDX_LEASE_DELEGATE_DENIED,
  RDX_LEASE_DUAL_OWNER,
  quarantineRdxContext,
} from './RdxRuntimeContextRegistry';
import type { RdxRuntimeContext } from '@shared/types/session';

function ctx(id: string, extras?: Partial<RdxRuntimeContext>): RdxRuntimeContext {
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

describe('RdxRuntimeContextRegistry leases', () => {
  beforeEach(() => {
    clearRdxContextLeases();
  });

  it('stores independent leases per session', () => {
    setRdxRuntimeContextForSession('s1', ctx('c1'), { projectId: 'p1' });
    setRdxRuntimeContextForSession('s2', ctx('c2'), { projectId: 'p2' });
    expect(getRdxContextLease('s1')?.contextId).toBe('c1');
    expect(getRdxContextLease('s2')?.contextId).toBe('c2');
    expect(getRdxContextLease('s1')?.ownerProjectId).toBe('p1');
  });

  it('assert ownership fail-closed without session', () => {
    setRdxRuntimeContextForSession('s1', ctx('c1'));
    expect(assertRdxContextLeaseOwnership({})).toBeNull();
    expect(assertRdxContextLeaseOwnership({ sessionId: 'other' })).toBeNull();
    expect(assertRdxContextLeaseOwnership({ sessionId: 's1', contextId: 'wrong' })).toBeNull();
    expect(assertRdxContextLeaseOwnership({ sessionId: 's1', contextId: 'c1' })?.contextId).toBe('c1');
    setRdxRuntimeContextForSession('scoped', ctx('scoped'), { projectId: 'project-a' });
    expect(assertRdxContextLeaseOwnership({ sessionId: 'scoped', projectId: 'project-b' })).toBeNull();
    expect(assertRdxContextLeaseOwnership({ sessionId: 'scoped', projectId: 'project-a' })?.contextId).toBe('scoped');
  });

  it('bumps version on update', () => {
    const a = setRdxRuntimeContextForSession('s1', ctx('c1'));
    const b = setRdxRuntimeContextForSession('s1', ctx('c1', { captureId: 'cap-2' }));
    expect(b!.version).toBeGreaterThan(a!.version);
    expect(getMostRecentRdxContextLease()?.contextId).toBe('c1');
  });

  it('fail-closes empty sessionId without writing a lease', () => {
    expect(setRdxRuntimeContextForSession('', ctx('c1'))).toBeNull();
    expect(setRdxRuntimeContextForSession('   ', ctx('c2'))).toBeNull();
    expect(listRdxContextLeaseSessionIds()).toEqual([]);
    expect(getMostRecentRdxContextLease()).toBeNull();
  });

  it('returns the most recently updated lease for UI summary', async () => {
    setRdxRuntimeContextForSession('s1', ctx('c1'));
    await new Promise((resolve) => setTimeout(resolve, 2));
    setRdxRuntimeContextForSession('s2', ctx('c2'));
    expect(getMostRecentRdxContextLease()?.contextId).toBe('c2');
    expect(listRdxContextLeaseSessionIds().sort()).toEqual(['s1', 's2']);
  });
});

describe('RdxRuntimeContextRegistry delegated leases', () => {
  beforeEach(() => {
    clearRdxContextLeases();
  });

  it('grants a child copy with delegatedFrom and leaves the parent unchanged', () => {
    setRdxRuntimeContextForSession('parent', ctx('c1', { captureId: 'cap-live' }), { projectId: 'p1' });
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
    expect(assertRdxContextLeaseOwnership({
      sessionId: 'parent::subagent::child-1',
      projectId: 'p1',
    })?.contextId).toBe('c1');
    expect(getRdxContextLease('parent')?.delegatedFrom).toBeUndefined();
    expect(getRdxContextLease('parent')?.ownerSessionId).toBe('parent');
  });

  it('fail-closes grant without a parent lease', () => {
    expect(() => grantDelegatedLease({
      parentSessionId: 'missing',
      childSessionId: 'child',
      ownerTurnId: 'turn-1',
    })).toThrow(new RegExp(RDX_LEASE_DELEGATE_DENIED));
    expect(getRdxContextLease('child')).toBeNull();
  });

  it('rejects a second live delegated child for the same parent', () => {
    setRdxRuntimeContextForSession('parent', ctx('c1'), { projectId: 'p1' });
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
    })).toThrow(new RegExp(RDX_LEASE_DUAL_OWNER));
    expect(getDelegatedChildSessionId('parent')).toBe('child-a');
    expect(getRdxContextLease('child-b')).toBeNull();
  });

  it('does not let a delegated child grant a grandchild', () => {
    setRdxRuntimeContextForSession('parent', ctx('c1'), { projectId: 'p1' });
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
    expect(getRdxContextLease('grandchild')).toBeNull();
  });

  it('revokes only the child lease', () => {
    setRdxRuntimeContextForSession('parent', ctx('c1'), { projectId: 'p1' });
    grantDelegatedLease({
      parentSessionId: 'parent',
      childSessionId: 'child',
      projectId: 'p1',
      ownerTurnId: 'turn-1',
    });
    expect(revokeDelegatedLease('child', { operationStopped: true })).toBe(true);
    expect(getRdxContextLease('child')).toBeNull();
    expect(assertRdxContextLeaseOwnership({ sessionId: 'child', projectId: 'p1' })).toBeNull();
    expect(getRdxContextLease('parent')?.contextId).toBe('c1');
    expect(getDelegatedChildSessionId('parent')).toBeNull();
  });

  it('allows a later grant after revoke', () => {
    setRdxRuntimeContextForSession('parent', ctx('c1'), { projectId: 'p1' });
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
    setRdxRuntimeContextForSession('parent', ctx('c1'), { projectId: 'p1' });
    expect(assertRdxContextLeaseOwnership({
      sessionId: 'parent::subagent::offline',
      projectId: 'p1',
    })).toBeNull();
  });
});

describe('exclusive delegated control and uncertain release', () => {
  beforeEach(clearRdxContextLeases);
  it('suspends parent operations and rebinding throughout the delegated interval', () => {
    setRdxRuntimeContextForSession('parent', ctx('c1'));
    grantDelegatedLease({ parentSessionId: 'parent', childSessionId: 'child', ownerTurnId: 't' });
    expect(assertRdxContextLeaseOwnership({ sessionId: 'parent' })).toBeNull();
    expect(assertRdxContextLeaseOwnership({ sessionId: 'child' })).not.toBeNull();
    expect(() => setRdxRuntimeContextForSession('parent', ctx('c2'))).toThrow(/join/);
    revokeDelegatedLease('child', { operationStopped: true });
    expect(assertRdxContextLeaseOwnership({ sessionId: 'parent' })).not.toBeNull();
  });
  it('does not return usable parent control when child exit is unconfirmed', () => {
    setRdxRuntimeContextForSession('parent', ctx('c1'));
    grantDelegatedLease({ parentSessionId: 'parent', childSessionId: 'child', ownerTurnId: 't' });
    revokeDelegatedLease('child', { operationStopped: false });
    expect(assertRdxContextLeaseOwnership({ sessionId: 'parent' })).toBeNull();
    expect(() => grantDelegatedLease({ parentSessionId: 'parent', childSessionId: 'next', ownerTurnId: 't2' })).toThrow(/recovery/);
  });
  it('late failed calls cannot quarantine a rebound identity', () => {
    const old = setRdxRuntimeContextForSession('s', ctx('c1'))!;
    const current = setRdxRuntimeContextForSession('s', ctx('c2'))!;
    quarantineRdxContext('s', old.version, 'late timeout');
    expect(assertRdxContextLeaseOwnership({ sessionId: 's' })?.version).toBe(current.version);
  });
});
