import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentRunPresentation } from '@shared/types/agenticTrace';
import { TraceProjectionRefreshService } from './TraceProjectionRefreshService';

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
});