import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextBreakdownContent } from './ContextBreakdownSheet';
import type { PreparedTurnContextSummary, RunContextUsageSummary } from '@shared/types/session';
import type { ContextUsageSelectedProfile } from './contextUsageDisplay';

vi.mock('../i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (!params) return key;
      return `${key}:${JSON.stringify(params)}`;
    },
  }),
}));

const usage: RunContextUsageSummary = {
  runId: 'run-1',
  providerId: 'provider',
  modelId: 'model',
  usagePercent: 12,
  promptBudgetTokens: 200_000,
  contextWindowTokens: 200_000,
  maxOutputTokens: 0,
  compactionThresholdTokens: 160_000,
  inputTokens: 20_000,
  outputTokens: 1_000,
  totalTokens: 21_000,
  occupiedTokens: 20_000,
  cacheHitTokens: 8_000,
  cacheMissTokens: 12_000,
  cacheSavedTokens: 8_000,
  lastTurnCacheHitRate: 40,
  cumulativeCacheHitRate: 38,
  breakdown: [{ id: 'conversation', tokens: 2_000 }],
  snapshotAt: 1,
};

const prepared: PreparedTurnContextSummary = {
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
  controls: { reasoningLevel: 'high', maxContextMode: false, fastModel: false },
  contextMode: 'normal',
  preparedInputTokens: 24_000,
  uncompactedInputTokens: 24_000,
  promptBudgetTokens: 200_000,
  contextWindowTokens: 200_000,
  maxOutputTokens: 0,
  compactionThresholdTokens: 160_000,
  usagePercent: 12,
  breakdown: [{ id: 'conversation', tokens: 2_400 }],
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
};

const profile = (overrides: Partial<ContextUsageSelectedProfile> = {}): ContextUsageSelectedProfile => ({
  contextWindowTokens: 200_000,
  contextBudgetTokens: 200_000,
  maxOutputTokens: 0,
  compactionThresholdTokens: 160_000,
  ...overrides,
});

describe('ContextBreakdownContent phase authority', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('labels the full-history estimate while the execution window is unresolved', () => {
    const html = renderToStaticMarkup(React.createElement(ContextBreakdownContent, {
      detailsExpanded: true,
      onDetailsExpandedChange: () => undefined,
      prepared: {
        ...prepared,
        preparedInputTokens: 943_100,
        uncompactedInputTokens: 943_100,
        promptBudgetTokens: 272_000,
        compactionThresholdTokens: 217_600,
        usagePercent: 100,
        breakdown: [{ id: 'conversation', tokens: 930_000 }],
      },
      phase: 'current',
      usage,
      selectedProfile: profile({ contextBudgetTokens: 272_000 }),
      stale: false,
    }));
    expect(html).toContain('contextBreakdown.windowPending');
    expect(html).toContain('contextBreakdown.windowPendingNote');
    expect(html).toContain('data-phase="unavailable"');
    expect(html).not.toContain('contextBreakdown.used');
    expect(html).not.toContain('contextBreakdown.turnOutput');
  });

  it('Preparing keeps the last actual structure instead of replacing it with a status card', () => {
    const html = renderToStaticMarkup(
      React.createElement(ContextBreakdownContent, {
        detailsExpanded: true,
        onDetailsExpandedChange: () => undefined,
        prepared: null,
        phase: 'preparing',
        usage,
        selectedProfile: profile(),
        stale: false,
      }),
    );
    expect(html).toContain('context-breakdown-hero');
    expect(html).toContain('context-breakdown-run-meter');
    expect(html).toContain('data-phase="actual"');
    expect(html).toContain('contextBreakdown.lastActual');
    expect(html).not.toContain('context-breakdown-preparing');
    expect(html).not.toContain('contextBreakdown.preparing');
    expect(html).toContain('context-breakdown-details');
  });

  it('uses the same meter and details structure when telemetry has not arrived', () => {
    const html = renderToStaticMarkup(
      React.createElement(ContextBreakdownContent, {
        detailsExpanded: true,
        onDetailsExpandedChange: () => undefined,
        prepared: null,
        phase: 'preparing',
        usage: null,
        selectedProfile: profile(),
        stale: false,
      }),
    );
    expect(html).toContain('context-breakdown-hero');
    expect(html).toContain('context-breakdown-run-meter');
    expect(html).toContain('data-phase="unavailable"');
    expect(html).toContain('contextBreakdown.noUsageYet');
    expect(html).not.toContain('data-testid="context-breakdown-cost"');
    expect(html).toContain('context-breakdown-details');
    expect(html).toContain('>—</span>');
    expect(html).not.toContain('context-breakdown-empty-state');
    expect(html).not.toContain('context-breakdown-preparing');
  });

  it('keeps authoritative zero values distinct from unavailable telemetry', () => {
    const html = renderToStaticMarkup(
      React.createElement(ContextBreakdownContent, {
        detailsExpanded: true,
        onDetailsExpandedChange: () => undefined,
        prepared: null,
        phase: 'idle',
        usage: {
          ...usage,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          occupiedTokens: 0,
          usagePercent: 0,
          breakdown: [],
        },
        selectedProfile: profile(),
        stale: false,
      }),
    );
    expect(html).toContain('contextBreakdown.used:{&quot;percent&quot;:&quot;0%&quot;}');
    expect(html).toContain('>0contextBreakdown.countSuffix.system_tools</span>');
    expect(html).not.toContain('data-phase="unavailable"');
  });

  it('Current request shows prepared hero without stacking historical Last actual meter', () => {
    const html = renderToStaticMarkup(
      React.createElement(ContextBreakdownContent, {
        detailsExpanded: true,
        onDetailsExpandedChange: () => undefined,
        prepared,
        phase: 'current',
        usage,
        selectedProfile: profile(),
        stale: false,
      }),
    );
    expect(html).toContain('contextBreakdown.currentRequest');
    expect(html).toContain('context-breakdown-hero');
    expect(html).toContain('data-testid="context-breakdown-run-meter"');
    expect(html).toContain('data-phase="current"');
    expect(html).toContain('contextBreakdown.requestUsage');
    expect(html).toContain('<dt>contextBreakdown.inputLabel</dt><dd>~24k</dd>');
    expect(html.match(/>—</g)?.length).toBeGreaterThanOrEqual(5);
    expect(html).not.toContain('context-breakdown-meter-eyebrow');
    expect(html).not.toContain('contextBreakdown.lastActual');
  });

  it('shows the latest context breakdown and cumulative run totals as separate sections', () => {
    const html = renderToStaticMarkup(
      React.createElement(ContextBreakdownContent, {
        detailsExpanded: true,
        onDetailsExpandedChange: () => undefined,
        prepared: null,
        phase: 'idle',
        usage: {
          ...usage,
          lastTurnCacheHitTokens: 0,
          lastTurnCacheMissTokens: 20_000,
          reasoningTokens: 320,
          cost: { total: 0, input: 0, output: 0 },
          cumulativeCost: 0.2,
        },
        selectedProfile: profile(),
        stale: false,
      }),
    );
    expect(html).toContain('contextBreakdown.lastActual');
    expect(html).toContain('data-testid="context-breakdown-run-meter"');
    expect(html.match(/data-testid="context-breakdown-run-meter"/g)?.length).toBe(1);
    expect(html).not.toContain('context-breakdown-meter-eyebrow');
    expect(html).toContain('contextBreakdown.latestBreakdown');
    expect(html).toContain('contextBreakdown.runTotals');
    expect(html).toContain('contextBreakdown.totalLabel');
    expect(html).toContain('contextBreakdown.groupDeferred');
    expect(html).toContain('contextBreakdown.reasoningLabel');
    expect(html).toContain('context-breakdown-meter-row');
    const sections = ['data-col="tokens"', 'data-col="cache"', 'data-col="reasoning"',
      'data-testid="context-breakdown-cost"', 'contextBreakdown.latestBreakdown', 'contextBreakdown.groupDeferred'];
    const positions = sections.map((section) => html.indexOf(section));
    expect(positions.every((index) => index >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(html).not.toContain('>0 / 20k<');
    expect(html).toContain('>8k / 12k<');
    expect(html).toContain('>32%<');
    expect(html).toContain('contextBreakdown.costThisTurn');
    expect(html).toContain('contextBreakdown.costThisRun');
    expect(html).not.toContain('contextBreakdown.costCacheRead');
    expect(html).not.toContain('context-breakdown-runtime');
    expect(html).not.toContain('semantic-replay');
    expect(html).not.toContain('stableTokenEstimate');
  });

  it('keeps a reported cumulative zero cost without inventing a request cost', () => {
    const html = renderToStaticMarkup(React.createElement(ContextBreakdownContent, {
      detailsExpanded: true, onDetailsExpandedChange: () => undefined,
      prepared: null, phase: 'idle', usage: { ...usage, cumulativeCost: 0 }, selectedProfile: profile(), stale: true,
    }));
    expect(html).toContain('contextBreakdown.lastRunTotals');
    expect(html).toContain('<dt>contextBreakdown.costThisRun</dt><dd>$0.00</dd>');
    expect(html).not.toContain('contextBreakdown.costThisTurn');
  });
  it('shows projected occupancy against the selected model window', () => {
    const html = renderToStaticMarkup(
      React.createElement(ContextBreakdownContent, {
        detailsExpanded: true,
        onDetailsExpandedChange: () => undefined,
        prepared: null,
        phase: 'idle',
        usage: {
          ...usage,
          usagePercent: 12,
          promptBudgetTokens: 1_000_000,
          contextWindowTokens: 1_000_000,
          maxOutputTokens: 0,
          compactionThresholdTokens: 800_000,
          occupiedTokens: 115_200,
          breakdown: [
            { id: 'conversation', tokens: 80_000 },
            { id: 'free', tokens: 884_800 },
          ],
        },
        selectedProfile: profile({
          contextWindowTokens: 1_000_000,
          contextBudgetTokens: 1_000_000,
          compactionThresholdTokens: 800_000,
        }),
        stale: false,
        estimated: true,
      }),
    );
    expect(html).toContain('contextBreakdown.projected');
    expect(html).toContain('contextBreakdown.used:{&quot;percent&quot;:&quot;~12%&quot;}');
    expect(html).toContain('data-tooltip="contextBreakdown.projectedNote"');
    expect(html).toContain('contextBreakdown.lastRunTotals');
    expect(html).toContain('>21k</strong>');
    expect(html).toContain('contextBreakdown.estimatedBreakdown');
    expect(html).toContain('>~884.8k</span>');
    expect(html).not.toContain('contextBreakdown.lastActual');
    expect(html).not.toContain('contextBreakdown.staleNote');
  });

  it('keeps the projected popover during preparing instead of reverting to Last actual', () => {
    const html = renderToStaticMarkup(
      React.createElement(ContextBreakdownContent, {
        detailsExpanded: true,
        onDetailsExpandedChange: () => undefined,
        prepared: null,
        phase: 'preparing',
        usage: {
          ...usage,
          usagePercent: 12,
          promptBudgetTokens: 1_000_000,
          contextWindowTokens: 1_000_000,
          maxOutputTokens: 0,
          compactionThresholdTokens: 800_000,
          occupiedTokens: 115_200,
          breakdown: [
            { id: 'conversation', tokens: 80_000 },
            { id: 'free', tokens: 884_800 },
          ],
        },
        selectedProfile: profile({
          contextWindowTokens: 1_000_000,
          contextBudgetTokens: 1_000_000,
          compactionThresholdTokens: 800_000,
        }),
        stale: false,
        estimated: true,
      }),
    );
    expect(html).toContain('contextBreakdown.projected');
    expect(html).toContain('contextBreakdown.used:{&quot;percent&quot;:&quot;~12%&quot;}');
    expect(html).toContain('contextBreakdown.projectedNote');
    expect(html).not.toContain('contextBreakdown.lastActual');
  });

  it('explains the compaction line and remaining generation budget', () => {
    const html = renderToStaticMarkup(
      React.createElement(ContextBreakdownContent, {
        detailsExpanded: false,
        onDetailsExpandedChange: () => undefined,
        prepared: null,
        phase: 'idle',
        usage: {
          ...usage,
          promptBudgetTokens: 1_000_000,
          contextWindowTokens: 1_000_000,
          maxOutputTokens: 384_000,
          compactionThresholdTokens: 800_000,
        },
        selectedProfile: profile({
          contextWindowTokens: 1_000_000,
          contextBudgetTokens: 1_000_000,
          maxOutputTokens: 384_000,
          compactionThresholdTokens: 800_000,
        }),
        stale: false,
      }),
    );
    expect(html).toContain('data-testid="context-breakdown-window-note"');
    expect(html).toContain('data-testid="context-breakdown-bar-threshold"');
    expect(html).toContain('contextBreakdown.budgetNote.threshold:{&quot;threshold&quot;:&quot;800k&quot;}');
    expect(html).toContain('<dt>contextBreakdown.turnOutput</dt><dd>~384k</dd>');
    expect(html).not.toContain('contextBreakdown.fullWindow');
    expect(html).toContain('20k / 1M');
    expect(html).not.toContain('context-breakdown-run-meter');
  });

  it('adds the full window only when it is larger than the prompt budget', () => {
    const html = renderToStaticMarkup(
      React.createElement(ContextBreakdownContent, {
        detailsExpanded: true,
        onDetailsExpandedChange: () => undefined,
        prepared: null,
        phase: 'idle',
        usage: {
          ...usage,
          promptBudgetTokens: 200_000,
          contextWindowTokens: 264_000,
          maxOutputTokens: 64_000,
          compactionThresholdTokens: 160_000,
        },
        selectedProfile: profile({
          contextWindowTokens: 264_000,
          contextBudgetTokens: 200_000,
          maxOutputTokens: 64_000,
          compactionThresholdTokens: 160_000,
        }),
        stale: false,
      }),
    );
    expect(html).toContain('<dt>contextBreakdown.fullWindow</dt><dd>264k</dd>');
    expect(html).toContain('20k / 200k');
  });
});
