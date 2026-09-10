import { expect, it, vi } from 'vitest';
import { ConversationBackgroundContinuation } from './ConversationBackgroundContinuation';
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const event = { sessionId: 'owner', executionId: 'execution', parentAgentId: 'general' as const };
it('attempts a failed continuation event once and only runs again for a new event', async () => {
 const run = vi.fn(async () => { throw new Error('provider unavailable'); });
 const continuation = new ConversationBackgroundContinuation(run);
 continuation.onSettled(event); continuation.notifyIdle('owner'); await tick();
 continuation.notifyIdle('owner'); await tick();
 expect(run).toHaveBeenCalledTimes(1);
 continuation.onSettled({ ...event, executionId: 'new-execution' }); continuation.notifyIdle('owner'); await tick();
 expect(run).toHaveBeenCalledTimes(2);
});
it('does not wake from a cancelled execution late event after user Stop', async () => {
 const run = vi.fn(async () => undefined); const continuation = new ConversationBackgroundContinuation(run);
 continuation.onSettled(event); continuation.suppress('owner');
 continuation.onSettled(event); continuation.notifyIdle('owner'); await tick(); expect(run).not.toHaveBeenCalled();
 continuation.resume('owner'); continuation.notifyIdle('owner'); await tick(); expect(run).not.toHaveBeenCalled();
 continuation.onSettled({ ...event, executionId: 'new-execution' }); continuation.notifyIdle('owner'); await tick(); expect(run).toHaveBeenCalledTimes(1);
});
it('attempts a newer queued event once when the in-flight event rejects', async () => {
 let rejectFirst!: (error: Error) => void;
 const first = new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
 const run = vi.fn().mockImplementationOnce(() => first).mockResolvedValue(undefined);
 const continuation = new ConversationBackgroundContinuation(run);
 continuation.onSettled(event); continuation.notifyIdle('owner');
 continuation.onSettled({ ...event, executionId: 'newer-while-busy' }); continuation.notifyIdle('owner');
 expect(run).toHaveBeenCalledTimes(1);
 rejectFirst(new Error('provider unavailable')); await tick();
 expect(run).toHaveBeenCalledTimes(2);
 expect(run.mock.calls[1][0].executionId).toBe('newer-while-busy');
 continuation.notifyIdle('owner'); await tick(); expect(run).toHaveBeenCalledTimes(2);
});
