import { describe, expect, it } from 'vitest';
import { executeConcurrentToolGroups } from './ConcurrentToolScheduler';

interface Call {
  id: string;
  name: string;
  safe: boolean;
}

interface Result {
  id: string;
  text: string;
  isError?: boolean;
}

function call(id: string, name: string, safe: boolean): Call {
  return { id, name, safe };
}

describe('executeConcurrentToolGroups', () => {
  it('runs a consecutive safe group concurrently and returns callIndex order', async () => {
    const started: string[] = [];
    const release: Array<() => void> = [];
    let startedCount = 0;
    let resolveStarted!: () => void;
    const bothStarted = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const resultsPromise = executeConcurrentToolGroups<Call, Result>({
      calls: [call('a', 'read_file', true), call('b', 'grep', true)],
      isSafe: (item) => item.safe,
      reserve: () => ({ ok: true }),
      executeOne: async (item) => {
        started.push(item.id);
        startedCount += 1;
        if (startedCount === 2) resolveStarted();
        await new Promise<void>((resolve) => {
          release.push(resolve);
        });
        return { id: item.id, text: item.id };
      },
      createBudgetFailure: (item, _index, limit) => ({ id: item.id, text: limit, isError: true }),
      createNotStarted: (item, _index, reason) => ({ id: item.id, text: reason, isError: true }),
    });
    await bothStarted;
    expect(started).toEqual(['a', 'b']);
    release[1]();
    release[0]();
    const results = await resultsPromise;
    expect(results.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('cuts an unsafe call into its own serial group', async () => {
    const order: string[] = [];
    await executeConcurrentToolGroups<Call, Result>({
      calls: [call('a', 'read_file', true), call('b', 'shell', false), call('c', 'grep', true)],
      isSafe: (item) => item.safe,
      reserve: () => ({ ok: true }),
      executeOne: async (item) => {
        order.push(`start:${item.id}`);
        await Promise.resolve();
        order.push(`end:${item.id}`);
        return { id: item.id, text: item.id };
      },
      createBudgetFailure: (item, _index, limit) => ({ id: item.id, text: limit, isError: true }),
      createNotStarted: (item, _index, reason) => ({ id: item.id, text: reason, isError: true }),
    });
    expect(order.indexOf('end:a')).toBeLessThan(order.indexOf('start:b'));
    expect(order.indexOf('end:b')).toBeLessThan(order.indexOf('start:c'));
  });

  it('does not start any call in a group when budget reservation fails', async () => {
    const started: string[] = [];
    const results = await executeConcurrentToolGroups<Call, Result>({
      calls: [call('a', 'read_file', true), call('b', 'grep', true), call('c', 'glob', true)],
      isSafe: () => true,
      reserve: () => ({ ok: false, limit: 'maxToolCalls' }),
      executeOne: async (item) => {
        started.push(item.id);
        return { id: item.id, text: 'ran' };
      },
      createBudgetFailure: (item, _index, limit) => ({ id: item.id, text: limit, isError: true }),
      createNotStarted: (item, _index, reason) => ({ id: item.id, text: reason, isError: true }),
    });
    expect(started).toEqual([]);
    expect(results.every((entry) => entry.text === 'maxToolCalls' && entry.isError)).toBe(true);
  });

  it('does not cancel already-dispatched calls and does not open the next group after a partial failure', async () => {
    const started: string[] = [];
    const results = await executeConcurrentToolGroups<Call, Result>({
      calls: [
        call('a', 'read_file', true),
        call('b', 'grep', true),
        call('c', 'glob', true),
      ],
      isSafe: () => true,
      reserve: () => ({ ok: true }),
      executeOne: async (item) => {
        started.push(item.id);
        if (item.id === 'a') {
          return { id: item.id, text: 'boom', isError: true };
        }
        return { id: item.id, text: 'ok' };
      },
      createBudgetFailure: (item, _index, limit) => ({ id: item.id, text: limit, isError: true }),
      createNotStarted: (item, _index, reason) => ({ id: item.id, text: reason, isError: true }),
      isErrorResult: (result) => result.isError === true,
    });
    expect(started).toEqual(['a', 'b', 'c']);
    expect(results[1]).toMatchObject({ id: 'b', text: 'ok' });
    expect(results[2]).toMatchObject({ id: 'c', text: 'ok' });
  });

  it('does not open a later unsafe group after an earlier failure', async () => {
    const started: string[] = [];
    const results = await executeConcurrentToolGroups<Call, Result>({
      calls: [call('a', 'read_file', true), call('b', 'shell', false)],
      isSafe: (item) => item.safe,
      reserve: () => ({ ok: true }),
      executeOne: async (item) => {
        started.push(item.id);
        return { id: item.id, text: item.id === 'a' ? 'fail' : 'ok', isError: item.id === 'a' };
      },
      createBudgetFailure: (item, _index, limit) => ({ id: item.id, text: limit, isError: true }),
      createNotStarted: (item, _index, reason) => ({ id: item.id, text: reason, isError: true }),
      isErrorResult: (result) => result.isError === true,
    });
    expect(started).toEqual(['a']);
    expect(results[1]?.text).toMatch(/prior group failed/);
  });

  it('joins in-flight calls with allSettled after abort', async () => {
    const controller = new AbortController();
    let aStarted = false;
    let aFinished = false;
    let bFinished = false;
    let resolveStarted!: () => void;
    const startedGate = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const resultsPromise = executeConcurrentToolGroups<Call, Result>({
      calls: [call('a', 'read_file', true), call('b', 'grep', true), call('c', 'glob', true)],
      isSafe: () => true,
      reserve: () => ({ ok: true }),
      executeOne: async (item) => {
        if (item.id === 'a') {
          aStarted = true;
          resolveStarted();
          await new Promise((resolve) => setTimeout(resolve, 30));
          aFinished = true;
          return { id: item.id, text: 'a' };
        }
        if (item.id === 'b') {
          await new Promise((resolve) => setTimeout(resolve, 20));
          bFinished = true;
          return { id: item.id, text: 'b' };
        }
        return { id: item.id, text: 'c' };
      },
      createBudgetFailure: (item, _index, limit) => ({ id: item.id, text: limit, isError: true }),
      createNotStarted: (item, _index, reason) => ({ id: item.id, text: reason, isError: true }),
      signal: controller.signal,
    });
    await startedGate;
    controller.abort();
    const results = await resultsPromise;
    expect(aStarted).toBe(true);
    expect(aFinished).toBe(true);
    expect(bFinished).toBe(true);
    expect(results.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });
});
