import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StorageIo } from './StorageIo';
import { PlanReviewStateStore } from './PlanReviewStateStore';

describe('PlanReviewStateStore', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  function createStore() {
    const root = roots[roots.length - 1]!;
    return new PlanReviewStateStore({
      io: new StorageIo(),
      sessions: { findSessionLocation: () => ({ sessionPath: root }) },
    });
  }

  it('starts revision 1 and increments until approved starts a new cycle', async () => {
    roots.push(await mkdtemp(path.join(os.tmpdir(), 'rdc-plan-state-')));
    await mkdir(roots[0]!, { recursive: true });
    const store = createStore();
    const first = store.beginRevision('sess', 'turn-a');
    expect(first).toMatchObject({ revision: 1, newCycle: true });
    const second = store.beginRevision('sess', 'turn-a');
    expect(second.planId).toBe(first.planId);
    expect(second.revision).toBe(2);
    store.markDecision('sess', 'rejected', { turnId: 'turn-a', planId: first.planId, revision: 2 });
    const third = store.beginRevision('sess', 'turn-a');
    expect(third.planId).toBe(first.planId);
    expect(third.revision).toBe(3);
    store.markDecision('sess', 'approved', { turnId: 'turn-a', planId: first.planId, revision: 3 }, { approvedHash: 'a'.repeat(64), frozenUri: 'session://plans/plan-x.md', approvedHandoff: { agent: 'general', label: 'Execute' } });
    const nextCycle = store.beginRevision('sess', 'turn-a');
    expect(nextCycle.newCycle).toBe(true);
    expect(nextCycle.planId).not.toBe(first.planId);
    expect(nextCycle.revision).toBe(1);
  });
  it('rejects invalid documents and preserves unsupported versions', async () => {
    roots.push(await mkdtemp(path.join(os.tmpdir(), 'rdc-plan-state-')));
    const store = createStore();
    const file = store.getStatePath('sess')!;
    for (const patch of [{ revision: -2 }, { status: 'nonsense' }, { approvedHandoff: 42 }, { updatedAt: undefined }]) {
      await writeFile(file, JSON.stringify({ schemaVersion: '1', planId: 'p', revision: 1, status: 'awaiting', updatedAt: 1, ...patch }));
      expect(() => store.read('sess')).toThrow(/STORAGE_CORRUPT/);
    }
    const future = JSON.stringify({ schemaVersion: '99', planId: 'p' });
    await writeFile(file, future);
    expect(() => store.read('sess')).toThrow(/STORAGE_SCHEMA_UNSUPPORTED/);
    expect(await readFile(file, 'utf8')).toBe(future);
  });
  it('starts a new plan cycle when the owning turn changes', async () => {
    roots.push(await mkdtemp(path.join(os.tmpdir(), 'rdc-plan-state-')));
    const store = createStore();
    const first = store.beginRevision('sess', 'turn-a');
    const revision = store.beginRevision('sess', 'turn-a');
    expect(revision).toMatchObject({ planId: first.planId, revision: 2, newCycle: false });
    const next = store.beginRevision('sess', 'turn-b');
    expect(next).toMatchObject({ revision: 1, newCycle: true });
    expect(next.planId).not.toBe(first.planId);
    expect(store.read('sess')).toMatchObject({ ownerTurnId: 'turn-b' });
  });
  it('cancels only the matching live review and rejects late decisions without rewriting history', async () => {
    roots.push(await mkdtemp(path.join(os.tmpdir(), 'rdc-plan-state-')));
    const store = createStore();
    const first = store.beginRevision('sess', 'turn-a');
    expect(store.cancelReview('sess', 'wrong', first.planId, 1)).toBe(false);
    expect(store.cancelReview('sess', 'turn-a', first.planId, 1)).toBe(true);
    expect(store.read('sess')?.status).toBe('cancelled');
    const next = store.beginRevision('sess', 'turn-b');
    expect(store.cancelReview('sess', 'turn-a', first.planId, 1)).toBe(false);
    expect(() => store.markDecision('sess', 'rejected', { turnId: 'turn-a', planId: first.planId, revision: 1 })).toThrow('SCOPE_CHANGED');
    expect(store.read('sess')).toMatchObject({ planId: next.planId, status: 'awaiting' });
    const file = store.getStatePath('sess')!;
    const original = JSON.stringify({ schemaVersion: '1', planId: 'unowned', revision: 4, status: 'rejected', updatedAt: 1 });
    await writeFile(file, original);
    expect(store.read('sess')?.ownerTurnId).toBeUndefined();
    expect(await readFile(file, 'utf8')).toBe(original);
    expect(store.beginRevision('sess', 'turn-b')).toMatchObject({ newCycle: true, revision: 1 });
  });

});
