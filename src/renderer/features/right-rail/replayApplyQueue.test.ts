import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReplayApplyQueue } from './replayApplyQueue';

afterEach(() => vi.useRealTimers());
describe('replay apply queue', () => {
  it('coalesces dragging and flushes the final value after an in-flight operation', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const apply = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue(undefined);
    const queue = createReplayApplyQueue<number>(apply, vi.fn());
    queue.enqueue(1); queue.enqueue(2);
    await vi.advanceTimersByTimeAsync(99);
    expect(apply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(apply.mock.calls).toEqual([[2]]);
    queue.enqueue(3); queue.enqueue(4, true); queue.enqueue(5, true);
    expect(apply).toHaveBeenCalledTimes(1);
    finish(); await vi.runAllTimersAsync();
    expect(apply.mock.calls).toEqual([[2], [5]]);
    queue.dispose();
  });
  it('drops pending changes when the session loses ownership', async () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    const queue = createReplayApplyQueue<number>(apply, vi.fn());
    queue.enqueue(20); queue.dispose();
    await vi.runAllTimersAsync();
    queue.enqueue(21, true);
    expect(apply).not.toHaveBeenCalled();
  });
  it('reports an apply failure and still accepts the latest intent', async () => {
    vi.useFakeTimers();
    const error = new Error('disconnected');
    const apply = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
    const onError = vi.fn();
    const queue = createReplayApplyQueue<number>(apply, onError);
    queue.enqueue(1, true); await vi.runAllTimersAsync();
    expect(onError).toHaveBeenCalledWith(error);
    queue.enqueue(2, true); await vi.runAllTimersAsync();
    expect(apply.mock.calls).toEqual([[1], [2]]);
    queue.dispose();
  });
});
