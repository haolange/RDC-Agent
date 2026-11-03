import { describe, expect, it } from 'vitest';
import { retainResourceUntilExit } from '../../runtime/ResourceExecutionLifetime';
import { ToolResourceArbiter, toolResourceKey } from './ToolResourceArbiter';

describe('ToolResourceArbiter', () => {
  it('serializes unsafe effects and releases only after the operation settles', async () => {
    const arbiter = new ToolResourceArbiter();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const first = arbiter.runExclusive('session/project', undefined, async () => {
      order.push('first-start');
      await new Promise<void>((resolve) => { releaseFirst = resolve; });
      order.push('first-end');
    });
    await Promise.resolve();
    const second = arbiter.runExclusive('session/project', undefined, async () => {
      order.push('second');
    });
    await Promise.resolve();
    expect(order).toEqual(['first-start']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['first-start', 'first-end', 'second']);
  });

  it('does not consume the queue when a waiter is aborted', async () => {
    const arbiter = new ToolResourceArbiter();
    let release!: () => void;
    const first = arbiter.runExclusive('same', undefined, () => new Promise<void>((resolve) => { release = resolve; }));
    const controller = new AbortController();
    const waiting = arbiter.runExclusive('same', controller.signal, async () => 'unexpected');
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    release();
    await first;
    await expect(arbiter.runExclusive('same', undefined, async () => 'ok')).resolves.toBe('ok');
  });

  it('allows safe reads together but excludes them during an unsafe effect', async () => {
    const arbiter = new ToolResourceArbiter();
    let release!: () => void;
    const writer = arbiter.runExclusive('owner', undefined, () => new Promise<void>((resolve) => { release = resolve; }));
    let readStarted = false;
    const read = arbiter.runShared('owner', undefined, async () => { readStarted = true; });
    await Promise.resolve();
    expect(readStarted).toBe(false);
    await new Promise((resolve) => setImmediate(resolve));
    release();
    await Promise.all([writer, read]);
    expect(readStarted).toBe(true);
    const starts: number[] = [];
    await Promise.all([
      arbiter.runShared('owner', undefined, async () => { starts.push(1); }),
      arbiter.runShared('owner', undefined, async () => { starts.push(2); }),
    ]);
    expect(starts).toHaveLength(2);
  });
});


it('rejects already aborted calls before acquiring a free resource', async () => {
  const arbiter = new ToolResourceArbiter();
  const controller = new AbortController(); controller.abort();
  await expect(arbiter.runShared('free', controller.signal, async () => 'bad')).rejects.toMatchObject({ name: 'AbortError' });
  await expect(arbiter.runExclusive('free', undefined, async () => 'ok')).resolves.toBe('ok');
});

it('drains readers immediately when the queued writer is aborted', async () => {
  const arbiter = new ToolResourceArbiter();
  let release!: () => void;
  const first = arbiter.runShared('key', undefined, () => new Promise<void>((resolve) => { release = resolve; }));
  await Promise.resolve();
  const controller = new AbortController();
  const writer = arbiter.runExclusive('key', controller.signal, async () => 'bad');
  const reader = arbiter.runShared('key', undefined, async () => 'reader');
  controller.abort();
  await expect(writer).rejects.toMatchObject({ name: 'AbortError' });
  await expect(reader).resolves.toBe('reader');
  release(); await first;
});

it('returns an orphan result but quarantines its resource until observed exit', async () => {
  const arbiter = new ToolResourceArbiter();
  let close!: () => void;
  const exit = new Promise<void>((resolve) => { close = resolve; });
  await expect(arbiter.runExclusive('project', undefined, async () => {
    retainResourceUntilExit(exit);
    return 'unconfirmed_orphan';
  })).resolves.toBe('unconfirmed_orphan');
  await expect(arbiter.runShared('project', undefined, async () => 'bad')).rejects.toThrow('quarantined');
  await expect(arbiter.runShared('unrelated', undefined, async () => 'ok')).resolves.toBe('ok');
  await expect(arbiter.runExclusive('unrelated', undefined, async () => 'bad')).rejects.toThrow('quarantined');
  close(); await new Promise((resolve) => setImmediate(resolve));
  await expect(arbiter.runExclusive('project', undefined, async () => 'recovered')).resolves.toBe('recovered');
});

it('canonicalizes relative project aliases and delegated session owners', () => {
  expect(toolResourceKey(process.cwd(), 'a')).toBe(toolResourceKey(`${process.cwd()}/src/..`, 'b'));
  expect(toolResourceKey(null, 'a::subagent::b')).toBe(toolResourceKey(null, 'a'));
});


it('rechecks cancellation after immediate acquisition before executing the effect', async () => {
  const arbiter = new ToolResourceArbiter();
  const controller = new AbortController();
  let ran = false;
  const call = arbiter.runShared('free', controller.signal, async () => { ran = true; });
  controller.abort();
  await expect(call).rejects.toMatchObject({ name: 'AbortError' });
  expect(ran).toBe(false);
  await expect(arbiter.runExclusive('free', undefined, async () => 'released')).resolves.toBe('released');
});

it('rechecks cancellation between queued grant and operation continuation', async () => {
  const arbiter = new ToolResourceArbiter();
  let release!: () => void;
  const first = arbiter.runExclusive('key', undefined, () => new Promise<void>((resolve) => { release = resolve; }));
  await new Promise((resolve) => setImmediate(resolve));
  const controller = new AbortController();
  let ran = false;
  const queued = arbiter.runShared('key', controller.signal, async () => { ran = true; });
  // The first continuation releases/grants; this continuation aborts before the queued effect resumes.
  release();
  await Promise.resolve();
  controller.abort();
  await first;
  await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
  expect(ran).toBe(false);
  await expect(arbiter.runExclusive('key', undefined, async () => 'released')).resolves.toBe('released');
});

it('serializes unsafe effects across projects while unrelated safe reads remain available', async () => {
 const arbiter = new ToolResourceArbiter(); let release!: () => void; let secondStarted = false;
 const first = arbiter.runExclusive('project-A', undefined, () => new Promise<void>((resolve) => { release = resolve; }));
 await new Promise((resolve) => setImmediate(resolve));
 const second = arbiter.runExclusive('project-B', undefined, async () => { secondStarted = true; });
 await arbiter.runShared('project-C', undefined, async () => 'safe');
 expect(secondStarted).toBe(false); release(); await Promise.all([first, second]); expect(secondStarted).toBe(true);
});
