import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ContextUsageIndicator } from './ContextUsageIndicator';
import type { ContextUsageSelectedProfile } from './contextUsageDisplay';

vi.mock('../i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('./ContextBreakdownPopover', () => ({
  ContextBreakdownPopover: () => null,
}));

const profile = (overrides: Partial<ContextUsageSelectedProfile> = {}): ContextUsageSelectedProfile => ({
  contextWindowTokens: 200_000,
  contextBudgetTokens: 200_000,
  maxOutputTokens: 0,
  compactionThresholdTokens: 160_000,
  ...overrides,
});

describe('ContextUsageIndicator', () => {
  it('keeps the ring percent-first without in-ring phase badges', () => {
    const idle = renderToStaticMarkup(
      React.createElement(ContextUsageIndicator, {
        usage: null,
        prepared: null,
        phase: 'idle',
        selectedProfile: profile(),
      }),
    );
    expect(idle).toContain('composer-usage-value-number');
    expect(idle).toContain('—');
    expect(idle).not.toContain('composer-usage-value-label');
    expect(idle).not.toContain('preparingBadge');
    expect(idle).not.toContain('contextBreakdown.preparingBadge');
    expect(idle).not.toContain('Prep');

    const preparing = renderToStaticMarkup(
      React.createElement(ContextUsageIndicator, {
        usage: null,
        prepared: null,
        phase: 'preparing',
        selectedProfile: profile(),
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
          promptBudgetTokens: 200_000,
          contextWindowTokens: 200_000,
          maxOutputTokens: 0,
          compactionThresholdTokens: 160_000,
          inputTokens: 84_000,
          outputTokens: 0,
          totalTokens: 84_000,
          occupiedTokens: 84_000,
          breakdown: null,
          snapshotAt: 1,
        },
        prepared: null,
        phase: 'actual',
        selectedProfile: profile(),
      }),
    );
    expect(actual).toContain('42%');
    expect(actual).not.toContain('>Actual<');
  });

  it('shows idle occupancy against the prompt budget rather than the full window', () => {
    const idle = renderToStaticMarkup(
      React.createElement(ContextUsageIndicator, {
        usage: null,
        prepared: null,
        phase: 'idle',
        selectedProfile: profile({
          contextWindowTokens: 1_000_000,
          contextBudgetTokens: 1_000_000,
          maxOutputTokens: 384_000,
          compactionThresholdTokens: 800_000,
        }),
      }),
    );
    expect(idle).toContain('title="contextBreakdown.noUsageYet 1M"');
    expect(idle).not.toContain('composer-usage-ring-threshold');
  });

  it('shows a projected percent after the selected model window changes', () => {
    const projected = renderToStaticMarkup(
      React.createElement(ContextUsageIndicator, {
        usage: {
          runId: 'run-1',
          providerId: 'provider',
          modelId: 'model',
          usagePercent: 12,
          promptBudgetTokens: 1_000_000,
          contextWindowTokens: 1_000_000,
          maxOutputTokens: 0,
          compactionThresholdTokens: 800_000,
          inputTokens: 115_200,
          outputTokens: 0,
          totalTokens: 115_200,
          occupiedTokens: 115_200,
          breakdown: null,
          snapshotAt: 1,
        },
        prepared: null,
        phase: 'idle',
        selectedProfile: profile({
          contextWindowTokens: 1_000_000,
          contextBudgetTokens: 1_000_000,
          compactionThresholdTokens: 800_000,
        }),
        estimated: true,
      }),
    );
    expect(projected).toContain('~12%');
    expect(projected).toContain('is-estimated');
    expect(projected).toContain('data-estimated="true"');
    expect(projected).toContain('title="contextBreakdown.projected ~12% 1M"');
    expect(projected).not.toContain('composer-usage-value-label');
  });

  it('keeps the preparing ring pending instead of snapping back to a last-actual badge', () => {
    const preparing = renderToStaticMarkup(
      React.createElement(ContextUsageIndicator, {
        usage: {
          runId: 'run-1',
          providerId: 'provider',
          modelId: 'model',
          usagePercent: 12,
          promptBudgetTokens: 1_000_000,
          contextWindowTokens: 1_000_000,
          maxOutputTokens: 0,
          compactionThresholdTokens: 800_000,
          inputTokens: 115_200,
          outputTokens: 0,
          totalTokens: 115_200,
          occupiedTokens: 115_200,
          breakdown: null,
          snapshotAt: 1,
        },
        prepared: null,
        phase: 'preparing',
        selectedProfile: profile({
          contextWindowTokens: 1_000_000,
          contextBudgetTokens: 1_000_000,
          compactionThresholdTokens: 800_000,
        }),
        estimated: true,
      }),
    );
    expect(preparing).toContain('…');
    expect(preparing).toContain('is-pending');
    expect(preparing).toContain('title="contextBreakdown.preparing"');
    expect(preparing).not.toContain('is-estimated');
    expect(preparing).not.toContain('data-estimated="true"');
  });

  it('does not apply the projected ring while a current prepared request is shown', () => {
    const current = renderToStaticMarkup(
      React.createElement(ContextUsageIndicator, {
        usage: {
          runId: 'run-1',
          providerId: 'provider',
          modelId: 'model',
          usagePercent: 12,
          promptBudgetTokens: 1_000_000,
          contextWindowTokens: 1_000_000,
          maxOutputTokens: 0,
          compactionThresholdTokens: 800_000,
          inputTokens: 24_000,
          outputTokens: 0,
          totalTokens: 24_000,
          occupiedTokens: 24_000,
          breakdown: null,
          snapshotAt: 1,
        },
        prepared: {
          requestId: 'request-1',
          turnId: 'turn-1',
          route: {
            providerId: 'provider',
            adapterId: 'openai-responses',
            selectedModelId: 'model',
            effectiveModelId: 'model',
            protocol: 'OpenAIResponses',
            catalogRevision: 'catalog-1',
            routeRevision: 'route-1',
            bindingIds: [],
          },
          wirePatch: { headers: {}, body: {} },
          controls: { reasoningLevel: 'off', maxContextMode: false, fastModel: false },
          contextMode: 'normal',
          preparedInputTokens: 24_000,
          uncompactedInputTokens: 24_000,
          promptBudgetTokens: 1_000_000,
          contextWindowTokens: 1_000_000,
          maxOutputTokens: 0,
          compactionThresholdTokens: 800_000,
          usagePercent: 2,
          breakdown: [],
          compactionApplied: false,
          filteredArtifactCount: 0,
          preparedAt: 2,
          continuation: {
            executionFingerprint: 'fp',
            strategy: 'semantic-replay',
            replayedArtifactCount: 0,
            droppedArtifactCount: 0,
            decisionCounts: [],
          },
          derivedContext: { status: 'none', compactedTurnCount: 0 },
          cache: {
            enabled: false,
            mode: 'none',
            keyCarrier: 'none',
            breakpointCarrier: 'none',
            ttl: 'none',
            breakpoint: 'none',
            stableTokenEstimate: 0,
            stableSegmentCount: 0,
            providerReported: false,
            reason: 'test',
          },
        },
        phase: 'current',
        selectedProfile: profile({
          contextWindowTokens: 1_000_000,
          contextBudgetTokens: 1_000_000,
          compactionThresholdTokens: 800_000,
        }),
        estimated: true,
      }),
    );
    expect(current).toContain('>2%<');
    expect(current).not.toContain('is-estimated');
    expect(current).not.toContain('data-estimated="true"');
  });
});
