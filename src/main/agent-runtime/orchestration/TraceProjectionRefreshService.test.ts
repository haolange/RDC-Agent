import { afterEach, describe, expect, it, vi } from 'vitest';
import { TraceProjectionRefreshService } from './TraceProjectionRefreshService';
import type { AgentRunPresentation } from '@shared/types/agenticTrace';

afterEach(() => vi.useRealTimers());

describe('TraceProjectionRefreshService', () => {
  it('coalesces one session and never refreshes a subagent session', async () => {
    vi.useFakeTimers();
    const presentation = { projectId: 'project-a', sessionId: 'session-a' } as AgentRunPresentation;
    const getProjection = vi.fn().mockResolvedValue({ success: true, presentation });
    const publish = vi.fn();
    const service = new TraceProjectionRefreshService({ getProjection, publish });

    service.schedule('session-a');
    service.schedule('session-a');
    service.schedule('session-a::subagent::one');
    await vi.advanceTimersByTimeAsync(40);

    expect(getProjection).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({ projectId: 'project-a', sessionId: 'session-a' }, presentation);
  });

  it('builds once more after an in-flight build instead of racing it, and publishes in build order', async () => {
    vi.useFakeTimers();
    const builds: Array<(value: unknown) => void> = [];
    const getProjection = vi.fn(
      () =>
        new Promise((resolve) => {
          builds.push(resolve);
        }),
    );
    const publish = vi.fn();
    const service = new TraceProjectionRefreshService({ getProjection, publish } as never);
    const presentation = (n: number) => ({ projectId: 'p', sessionId: 's', updatedAt: String(n) });

    service.schedule('s');
    await vi.advanceTimersByTimeAsync(40);
    service.schedule('s');
    await vi.advanceTimersByTimeAsync(40);
    service.schedule('s');
    await vi.advanceTimersByTimeAsync(40);
    expect(getProjection).toHaveBeenCalledTimes(1);

    builds[0]!({ success: true, presentation: presentation(1) });
    await vi.advanceTimersByTimeAsync(0);
    expect(getProjection).toHaveBeenCalledTimes(2);
    builds[1]!({ success: true, presentation: presentation(2) });
    await vi.advanceTimersByTimeAsync(0);
    expect(getProjection).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls.map(([, published]) => published.updatedAt)).toEqual(['1', '2']);
  });
});
