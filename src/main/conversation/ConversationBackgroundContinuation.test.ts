import { describe, expect, it, vi } from 'vitest';
import { ConversationBackgroundContinuation } from './ConversationBackgroundContinuation';

const event = (executionId: string) => ({ sessionId: 'session', executionId, parentAgentId: 'general' as const });

describe('ConversationBackgroundContinuation', () => {
  it('drains a newer event after the current continuation without deleting it by execution id', async () => {
    let release!: () => void;
    const first = new Promise<void>((resolve) => { release = resolve; });
    const run = vi.fn().mockReturnValueOnce(first).mockResolvedValue(undefined);
    const coordinator = new ConversationBackgroundContinuation(run);
    coordinator.onSettled(event('same'));
    coordinator.notifyIdle('session');
    coordinator.onSettled(event('same'));
    release();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
  });

  it('does not spin on a failed continuation and suppression blocks late wakeups', async () => {
    const run = vi.fn().mockRejectedValue(new Error('provider unavailable'));
    const coordinator = new ConversationBackgroundContinuation(run);
    coordinator.onSettled(event('one'));
    coordinator.notifyIdle('session');
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    await Promise.resolve(); await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
    coordinator.suppress('session');
    coordinator.onSettled(event('late'));
    coordinator.notifyIdle('session');
    expect(run).toHaveBeenCalledTimes(1);
  });
});
