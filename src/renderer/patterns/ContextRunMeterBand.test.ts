import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ContextRunMeterBand } from './ContextRunMeterBand';
import { buildContextRunMeterModel } from './contextRunMeterModel';

vi.mock('../i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe('ContextRunMeterBand', () => {
  it('keeps unknown, estimated, and real zero values distinct in one three-card model', () => {
    expect(buildContextRunMeterModel(null, null).map((card) => card.primaryValue)).toEqual(['—', '—', '—']);
    const prepared = { preparedInputTokens: 9_800 } as Parameters<typeof buildContextRunMeterModel>[1];
    const current = buildContextRunMeterModel(null, prepared);
    expect(current.map((card) => card.primaryValue)).toEqual(['~9.8k', '—', '—']);
    expect(current[0].details.map((detail) => detail.value)).toEqual(['~9.8k', '—']);
    const actual = buildContextRunMeterModel({
      totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheSavedTokens: 0,
      cacheHitTokens: 0, cacheMissTokens: 0, reasoningTokens: 0,
      lastTurnCacheHitRate: 0, cumulativeCacheHitRate: 0,
    } as Parameters<typeof buildContextRunMeterModel>[0], null);
    expect(actual.map((card) => card.primaryValue)).toEqual(['0', '0', '0']);
    expect(actual[1].details.map((detail) => detail.value)).toEqual(['0%', '0%', '0 / 0']);
  });
  it('renders three independent metric cards for tokens, cache, and reasoning', () => {
    const html = renderToStaticMarkup(
      React.createElement(ContextRunMeterBand, {
        usage: {
          runId: 'run-1',
          providerId: 'provider',
          modelId: 'model',
          usagePercent: 12,
          promptBudgetTokens: 616_000,
          contextWindowTokens: 1_000_000,
          maxOutputTokens: 384_000,
          compactionThresholdTokens: 800_000,
          inputTokens: 20_000,
          outputTokens: 1_000,
          totalTokens: 21_000,
          occupiedTokens: 20_000,
          cacheHitTokens: 8_000,
          cacheMissTokens: 12_000,
          cacheSavedTokens: 8_000,
          lastTurnCacheHitRate: 40,
          cumulativeCacheHitRate: 38,
          reasoningTokens: 4_000,
          breakdown: null,
          snapshotAt: 1,
        },
      }),
    );
    expect(html).toContain('data-testid="context-breakdown-run-meter"');
    expect(html).toContain('data-columns="3"');
    expect(html).toContain('data-col="tokens"');
    expect(html).toContain('data-col="cache"');
    expect(html).toContain('data-col="reasoning"');
    expect(html.match(/class="context-breakdown-run-col"/g)?.length).toBe(3);
    expect(html).toContain('context-breakdown-run-columns');
  });
});
