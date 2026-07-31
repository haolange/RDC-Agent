import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../workflow/debugger/WorkflowProjectionPublisher', () => ({
  workflowProjectionPublisher: {
    publishRunUsage: vi.fn(),
  },
}));

vi.mock('../sessions/StorageAdapter', () => ({
  storageAdapter: {
    writeSessionUsage: vi.fn(),
    readSessionUsage: vi.fn(() => null),
    readSession: vi.fn(() => null),
  },
}));

vi.mock('./EffectiveModelResolver', () => ({
  planEffectiveModelRequest: vi.fn(() => ({
    ok: true,
    plan: { contextBudgetTokens: 100_000 },
  })),
}));

vi.mock('./SettingsService', () => ({
  settingsService: {
    getAll: vi.fn(() => ({})),
  },
}));

import { storageAdapter } from '../sessions/StorageAdapter';
import { DebuggerLlmService } from './DebuggerLlmService';

describe('DebuggerLlmService cache aggregation', () => {
  let service: DebuggerLlmService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DebuggerLlmService();
  });

  it('accumulates hit/miss and exposes last-turn vs cumulative rates', () => {
    service.recordAgentTurnUsage({
      runId: 'run_1',
      turnId: 'turn_1',
      sessionId: 'sess_1',
      providerId: 'openai',
      modelId: 'gpt',
      inputTokens: 100,
      outputTokens: 10,
      cacheHitTokens: 20,
      cacheMissTokens: 80,
      precomputedBreakdown: [],
    });
    service.recordAgentTurnUsage({
      runId: 'run_1',
      turnId: 'turn_1',
      sessionId: 'sess_1',
      providerId: 'openai',
      modelId: 'gpt',
      inputTokens: 100,
      outputTokens: 5,
      cacheHitTokens: 90,
      cacheMissTokens: 10,
      precomputedBreakdown: [],
    });

    const usage = service.getSessionContextUsage({ sessionId: 'sess_1', runId: 'run_1' }).usage;
    expect(usage).toMatchObject({
      cacheHitTokens: 110,
      cacheMissTokens: 90,
      cacheSavedTokens: 110,
      lastTurnCacheHitTokens: 90,
      lastTurnCacheMissTokens: 10,
      lastTurnCacheHitRate: 90,
      cumulativeCacheHitRate: 55,
      inputTokens: 200,
      outputTokens: 15,
    });
  });

  it('clears last-turn cache when the latest call has no cache telemetry', () => {
    service.recordAgentTurnUsage({
      runId: 'run_2',
      turnId: 'turn_2',
      sessionId: 'sess_2',
      providerId: 'openai',
      modelId: 'gpt',
      inputTokens: 50,
      outputTokens: 2,
      cacheHitTokens: 40,
      cacheMissTokens: 10,
      precomputedBreakdown: [],
    });
    service.recordAgentTurnUsage({
      runId: 'run_2',
      turnId: 'turn_2',
      sessionId: 'sess_2',
      providerId: 'openai',
      modelId: 'gpt',
      inputTokens: 40,
      outputTokens: 2,
      precomputedBreakdown: [],
    });

    const usage = service.getSessionContextUsage({ sessionId: 'sess_2', runId: 'run_2' }).usage;
    expect(usage?.cacheHitTokens).toBe(40);
    expect(usage?.cacheMissTokens).toBe(10);
    expect(usage?.cacheSavedTokens).toBe(40);
    expect(usage?.cumulativeCacheHitRate).toBe(80);
    expect(usage?.lastTurnCacheHitTokens).toBeUndefined();
    expect(usage?.lastTurnCacheMissTokens).toBeUndefined();
    expect(usage?.lastTurnCacheHitRate).toBeUndefined();
  });

  it('omits cache block fields when no call reported cache stats', () => {
    service.recordAgentTurnUsage({
      runId: 'run_3',
      turnId: 'turn_3',
      sessionId: 'sess_3',
      providerId: 'openai',
      modelId: 'gpt',
      inputTokens: 10,
      outputTokens: 1,
      precomputedBreakdown: [],
    });
    const usage = service.getSessionContextUsage({ sessionId: 'sess_3', runId: 'run_3' }).usage;
    expect(usage?.cacheHitTokens).toBeUndefined();
    expect(usage?.cacheMissTokens).toBeUndefined();
    expect(usage?.cacheSavedTokens).toBeUndefined();
    expect(usage?.cumulativeCacheHitRate).toBeUndefined();
  });
  it('uses the top-level turn as the ordinary conversation key and retains the latest route', () => {
    service.recordAgentTurnUsage({
      turnId: 'turn_ordinary',
      sessionId: 'sess_ordinary',
      providerId: 'provider-a',
      modelId: 'model-a',
      inputTokens: 12,
      outputTokens: 1,
      precomputedBreakdown: [],
    });
    service.recordAgentTurnUsage({
      turnId: 'turn_ordinary',
      sessionId: 'sess_ordinary',
      providerId: 'provider-b',
      modelId: 'model-b',
      inputTokens: 8,
      outputTokens: 2,
      precomputedBreakdown: [],
    });

    const result = service.getSessionContextUsage({ sessionId: 'sess_ordinary' });
    expect(result.stale).toBe(false);
    expect(result.usage).toMatchObject({
      runId: 'turn_ordinary',
      providerId: 'provider-b',
      modelId: 'model-b',
      inputTokens: 20,
      outputTokens: 3,
    });
    expect(service.getSessionContextUsage({ sessionId: 'sess_other', runId: 'turn_ordinary' })).toEqual({
      usage: null,
      stale: false,
    });
  });

  it('marks only persisted usage as stale', () => {
    vi.mocked(storageAdapter.readSessionUsage).mockReturnValue({
      runId: 'run_persisted',
      providerId: 'openai',
      modelId: 'gpt',
      inputTokens: 8,
      outputTokens: 2,
      totalTokens: 10,
      contextWindowTokens: 100,
      usagePercent: 8,
      occupiedTokens: 8,
      breakdown: null,
      snapshotAt: 1,
    });

    expect(service.getSessionContextUsage({ sessionId: 'sess_persisted' })).toMatchObject({
      stale: true,
      usage: { runId: 'run_persisted' },
    });
  });
  it('does not persist telemetry-free zero usage as an actual snapshot', () => {
    vi.mocked(storageAdapter.readSessionUsage).mockReturnValue(null);
    service.recordAgentTurnUsage({
      turnId: 'turn_zero',
      sessionId: 'sess_zero',
      providerId: 'kimi-coding-plan',
      modelId: 'kimi-for-coding',
      inputTokens: 0,
      outputTokens: 0,
      precomputedBreakdown: [],
    });

    expect(service.getSessionContextUsage({ sessionId: 'sess_zero' })).toEqual({
      usage: null,
      stale: false,
    });
    expect(storageAdapter.writeSessionUsage).not.toHaveBeenCalled();
  });

  it('treats a persisted telemetry-free zero snapshot as absent', () => {
    vi.mocked(storageAdapter.readSessionUsage).mockReturnValue({
      runId: 'turn_zero_persisted',
      providerId: 'kimi-coding-plan',
      modelId: 'kimi-for-coding',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextWindowTokens: 256_000,
      usagePercent: 0,
      occupiedTokens: 0,
      breakdown: null,
      snapshotAt: 1,
    });

    expect(service.getSessionContextUsage({ sessionId: 'sess_zero_persisted' })).toEqual({
      usage: null,
      stale: false,
    });
  });

});
