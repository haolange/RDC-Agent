import { describe, it, expect, beforeEach } from 'vitest';
import {
  setRdxRuntimeContextForSession,
  getRdxContextLease,
  assertRdxContextLeaseOwnership,
  clearRdxContextLeases,
  getRdxRuntimeContext,
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
  });

  it('bumps version on update', () => {
    const a = setRdxRuntimeContextForSession('s1', ctx('c1'));
    const b = setRdxRuntimeContextForSession('s1', ctx('c1', { captureId: 'cap-2' }));
    expect(b!.version).toBeGreaterThan(a!.version);
    expect(getRdxRuntimeContext()?.contextId).toBe('c1');
  });
});
