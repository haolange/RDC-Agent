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

import { DebuggerLlmService } from './DebuggerLlmService';

describe('DebuggerLlmService cache aggregation', () => {
  let service: DebuggerLlmService;

  beforeEach(() => {
    service = new DebuggerLlmService();
  });

  it('accumulates hit/miss and exposes last-turn vs cumulative rates', () => {
    service.recordAgentTurnUsage({
      runId: 'run_1',
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
      sessionId: 'sess_1',
      providerId: 'openai',
      modelId: 'gpt',
      inputTokens: 100,
      outputTokens: 5,
      cacheHitTokens: 90,
      cacheMissTokens: 10,
      precomputedBreakdown: [],
    });

    const usage = service.getRunContextUsage('run_1');
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
      sessionId: 'sess_2',
      providerId: 'openai',
      modelId: 'gpt',
      inputTokens: 40,
      outputTokens: 2,
      precomputedBreakdown: [],
    });

    const usage = service.getRunContextUsage('run_2');
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
      sessionId: 'sess_3',
      providerId: 'openai',
      modelId: 'gpt',
      inputTokens: 10,
      outputTokens: 1,
      precomputedBreakdown: [],
    });
    const usage = service.getRunContextUsage('run_3');
    expect(usage?.cacheHitTokens).toBeUndefined();
    expect(usage?.cacheMissTokens).toBeUndefined();
    expect(usage?.cacheSavedTokens).toBeUndefined();
    expect(usage?.cumulativeCacheHitRate).toBeUndefined();
  });
});
