import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunContextUsageSummary } from '@shared/types/session';

const { readSession, getSessionContextUsage } = vi.hoisted(() => ({
  readSession: vi.fn(),
  getSessionContextUsage: vi.fn(),
}));

vi.mock('../sessions/StorageAdapter', () => ({
  storageAdapter: { readSession },
}));

vi.mock('../settings/DebuggerLlmService', () => ({
  debuggerLlmService: { getSessionContextUsage },
}));

describe('workflow:getRunUsage boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the canonical usage result without a second usage wrapper', async () => {
    const usage: RunContextUsageSummary = {
      runId: 'run-1',
      providerId: 'provider-1',
      modelId: 'model-1',
      inputTokens: 47_616,
      outputTokens: 2_883,
      totalTokens: 50_499,
      promptBudgetTokens: 1_000_000,
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 0,
      compactionThresholdTokens: 800_000,
      usagePercent: 1,
      occupiedTokens: 13_056,
      breakdown: null,
      snapshotAt: 123,
    };
    readSession.mockReturnValue({ sessionId: 'session-1' });
    getSessionContextUsage.mockReturnValue({ usage, stale: true });
    const { readRunContextUsage } = await import('./runContextUsageBoundary');

    const result = readRunContextUsage({ sessionId: 'session-1', runId: 'run-1' });

    expect(result).toEqual({ usage, stale: true });
    expect(result.usage).toBe(usage);
    expect(result.usage).not.toHaveProperty('usage');
  });

  it('returns an honest empty result when the session does not exist', async () => {
    readSession.mockReturnValue(null);
    const { readRunContextUsage } = await import('./runContextUsageBoundary');

    expect(readRunContextUsage({ sessionId: 'missing' })).toEqual({ usage: null, stale: false });
    expect(getSessionContextUsage).not.toHaveBeenCalled();
  });
});
