import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ContextUsageIndicator } from './ContextUsageIndicator';

vi.mock('../i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('./ContextBreakdownPopover', () => ({
  ContextBreakdownPopover: () => null,
}));

describe('ContextUsageIndicator', () => {
  it('keeps the ring percent-first without in-ring phase badges', () => {
    const idle = renderToStaticMarkup(
      React.createElement(ContextUsageIndicator, {
        usage: null,
        prepared: null,
        phase: 'idle',
        selectedContextWindowTokens: 200_000,
      }),
    );
    expect(idle).toContain('composer-usage-value-number');
    expect(idle).toContain('—');
    expect(idle).not.toContain('composer-usage-value-label');
    expect(idle).not.toContain('preparingBadge');
    expect(idle).not.toContain('contextBreakdown.preparingBadge');
    expect(idle).not.toContain('准备');
    expect(idle).not.toContain('Prep');

    const preparing = renderToStaticMarkup(
      React.createElement(ContextUsageIndicator, {
        usage: null,
        prepared: null,
        phase: 'preparing',
        selectedContextWindowTokens: 200_000,
      }),
    );
    expect(preparing).toContain('…');
    expect(preparing).toContain('is-pending');
    expect(preparing).toContain('title="contextBreakdown.preparing"');
    expect(preparing).not.toContain('composer-usage-value-label');

    const actual = renderToStaticMarkup(
      React.createElement(ContextUsageIndicator, {
        usage: {
          runId: 'run-1',
          providerId: 'provider',
          modelId: 'model',
          usagePercent: 42,
          contextWindowTokens: 200_000,
          inputTokens: 84_000,
          outputTokens: 0,
          totalTokens: 84_000,
          occupiedTokens: 84_000,
          breakdown: null,
          snapshotAt: 1,
        },
        prepared: null,
        phase: 'actual',
        selectedContextWindowTokens: 200_000,
      }),
    );
    expect(actual).toContain('42%');
    expect(actual).not.toContain('>Actual<');
    expect(actual).not.toContain('实际');
  });
});
