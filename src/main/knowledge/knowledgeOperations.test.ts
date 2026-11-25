import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorCodeOf } from '@shared/errors/appError';
import { expectMonotonicProgress } from '../testing/knowledgeProgress';
import { createKnowledgeProgressThrottle, KnowledgeOperationRegistry } from './knowledgeOperations';
import type { KnowledgeOperationProgress } from '@shared/types/knowledgeOperation';

describe('knowledge progress throttle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends at most ten events a second, coalesces to the newest report and always delivers the last one', () => {
    const events: KnowledgeOperationProgress[] = [];
    const progress = createKnowledgeProgressThrottle('op-1', (event) => events.push(event));
    for (let done = 0; done <= 500; done += 1) {
      progress.report('indexing', done, 500);
      vi.advanceTimersByTime(2);
    }
    // 1000ms of reports, one every 2ms: the first goes out at once, then one per 100ms window.
    expect(events.length).toBeLessThanOrEqual(11);
    expect(events.length).toBeGreaterThan(5);
    progress.flush();
    expect(events.at(-1)).toEqual({ operationId: 'op-1', phase: 'indexing', done: 500, total: 500 });
    expectMonotonicProgress(events);
    progress.report('indexing', 1, 500);
    vi.runAllTimers();
    expect(events.at(-1)?.done).toBe(500);
  });

  it('delivers a report that waited for its window when the work goes quiet', () => {
    const events: KnowledgeOperationProgress[] = [];
    const progress = createKnowledgeProgressThrottle('op-2', (event) => events.push(event));
    progress.report('writing', 0, 3);
    progress.report('writing', 1, 3);
    expect(events).toHaveLength(1);
    vi.advanceTimersByTime(100);
    expect(events.map((event) => event.done)).toEqual([0, 1]);
  });
});

describe('knowledge operation registry', () => {
  it('cancels a running operation by id with the registered code and forgets it once settled', async () => {
    const events: KnowledgeOperationProgress[] = [];
    const registry = new KnowledgeOperationRegistry((event) => events.push(event), 0);
    let release!: () => void;
    const running = registry.run('op-3', async ({ signal, onProgress }) => {
      onProgress('reading', 0, 2);
      await new Promise<void>((resolve) => { release = resolve; });
      signal.throwIfAborted();
      onProgress('reading', 1, 2);
      return 'done';
    });
    await expect(registry.run('op-3', async () => 'second')).rejects.toThrow('IPC_VALIDATION_ERROR');
    expect(registry.cancel('op-3')).toBe(true);
    expect(registry.cancel('op-3')).toBe(false);
    release();
    const failure = await running.catch((error: unknown) => error);
    expect(errorCodeOf(failure)).toBe('KNOWLEDGE_OPERATION_CANCELLED');
    expect(events).toEqual([{ operationId: 'op-3', phase: 'reading', done: 0, total: 2 }]);
    expect(registry.cancel('op-3')).toBe(false);
    await expect(registry.run('op-3', async () => 'again')).resolves.toBe('again');
  });

  it('stops every running operation on shutdown and waits for each to settle', async () => {
    const registry = new KnowledgeOperationRegistry(() => undefined);
    const settled: string[] = [];
    const work = (id: string) => registry.run(id, ({ signal }) => new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => setTimeout(() => {
        settled.push(id);
        resolve();
      }, 5));
    }));
    const runs = [work('a'), work('b')];
    await registry.abortAll();
    expect(settled.sort()).toEqual(['a', 'b']);
    await Promise.all(runs);
  });
});
