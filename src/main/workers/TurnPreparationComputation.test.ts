import { describe, expect, it } from 'vitest';
import type { UserMessage } from '../agent-runtime/core/types';
import { computeTurnPreparation } from './TurnPreparationComputation';
import { TurnPreparationWorkerPool } from './TurnPreparationWorkerPool';

const user = (content: string, timestamp: number): UserMessage => ({ role: 'user', content, timestamp });

describe('turn preparation worker computation', () => {
  it('preserves the current user message while compacting within a bounded request budget', async () => {
    const messages = Array.from({ length: 60 }, (_, index) => user(`history-${index}-${'x'.repeat(40)}`, index));
    messages.push(user('current prompt', 100));
    const result = await computeTurnPreparation({
      messages,
      modelId: 'model',
      messageBudget: 80,
      imageTokenAdjustment: 0,
    });

    expect(result.compactionApplied).toBe(true);
    expect(result.compactedMessages.at(-1)).toMatchObject({ role: 'user', content: 'current prompt' });
    expect(result.afterConversationTokens).toBeLessThanOrEqual(result.beforeConversationTokens);
  });

  it('rejects an aborted queued preparation before running local fallback work', async () => {
    const pool = new TurnPreparationWorkerPool(1);
    const controller = new AbortController();
    controller.abort();

    await expect(pool.run({
      messages: [user('current prompt', 1)],
      modelId: 'model',
      messageBudget: 1_000,
      imageTokenAdjustment: 0,
    }, controller.signal)).rejects.toThrow('REQUEST_CANCELLED');
  });
});
