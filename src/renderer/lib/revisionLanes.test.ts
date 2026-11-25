import { afterEach, describe, expect, it, vi } from 'vitest';
import { RevisionLanes, nextClientRevision } from './revisionLanes';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('revision lanes', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('keeps revisions growing across lanes and after the clock moves back', () => {
    vi.useFakeTimers({ now: 2_000 });
    const first = nextClientRevision();
    vi.setSystemTime(1_000);
    const second = nextClientRevision();
    expect(first).toBeGreaterThanOrEqual(2_000_000);
    expect(second).toBeGreaterThan(first);
  });

  it('starts above revisions a previous renderer issued, because they come from the clock', () => {
    // Main keeps the newest revision of each lane across renderer reloads; a fresh renderer's first revision is newer.
    const previousRendererRevision = Date.now() * 1_000 - 1;
    expect(new RevisionLanes().begin('provider:a')).toBeGreaterThan(previousRendererRevision);
  });

  it('orders each lane on its own: a later intent supersedes only its own lane', () => {
    const lanes = new RevisionLanes();
    const a1 = lanes.begin('a');
    const b1 = lanes.begin('b');
    const a2 = lanes.begin('a');
    expect(lanes.isLatest('a', a1)).toBe(false);
    expect(lanes.isLatest('a', a2)).toBe(true);
    expect(lanes.isLatest('b', b1)).toBe(true);
  });

  it('applies a result only when it is newer than the last one applied on its lane', () => {
    const lanes = new RevisionLanes();
    const older = lanes.begin('a');
    const newer = lanes.begin('a');
    const applied: number[] = [];
    expect(lanes.applyIfNewer('a', newer, () => applied.push(newer))).toBe(true);
    // The answer to the earlier intent arrives late and changes nothing.
    expect(lanes.applyIfNewer('a', older, () => applied.push(older))).toBe(false);
    expect(lanes.applyIfNewer('b', older, () => applied.push(older))).toBe(true);
    expect(applied).toEqual([newer, older]);
  });

  it('settles after every write of the lane, including one begun while waiting, and reports the newest failure', async () => {
    const lanes = new RevisionLanes();
    const first = deferred<string>();
    const second = deferred<string>();
    lanes.track('a', lanes.begin('a'), first.promise);
    expect(lanes.busy('a')).toBe(true);
    let settled = false;
    const waiting = lanes.settled('a').then(() => { settled = true; }, (error: Error) => error.message);
    lanes.track('a', lanes.begin('a'), second.promise);
    first.resolve('one');
    await first.promise;
    expect(settled).toBe(false);
    second.reject(new Error('disk full'));
    await expect(waiting).resolves.toBe('disk full');
    expect(lanes.busy('a')).toBe(false);
    await expect(lanes.settled('a')).resolves.toBeUndefined();
  });

  it('settles at once when a failed write is followed by a successful one', async () => {
    const lanes = new RevisionLanes();
    const failed = Promise.reject(new Error('offline'));
    lanes.track('a', lanes.begin('a'), failed);
    lanes.track('a', lanes.begin('a'), Promise.resolve('saved'));
    await expect(lanes.settled('a')).resolves.toBeUndefined();
    await expect(failed).rejects.toThrow('offline');
  });

  it('forgets a lane so the late answer of an intent begun before is not the latest', () => {
    const lanes = new RevisionLanes();
    const revision = lanes.begin('scope');
    lanes.forget('scope');
    expect(lanes.isLatest('scope', revision)).toBe(false);
  });
});
