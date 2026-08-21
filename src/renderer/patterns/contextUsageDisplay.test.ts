import { describe, expect, it } from 'vitest';
import type { PreparedTurnContextSummary, RunContextUsageSummary } from '@shared/types/session';
import {
  resolveDisplayedCompactionThreshold,
  resolveDisplayedGeneratable,
  resolveDisplayedMaxOutput,
  resolveDisplayedPromptBudget,
  type ContextUsageSelectedProfile,
} from './contextUsageDisplay';

const profile: ContextUsageSelectedProfile = {
  contextWindowTokens: 1_000_000,
  contextBudgetTokens: 1_000_000,
  maxOutputTokens: 384_000,
  compactionThresholdTokens: 800_000,
};

const usage: RunContextUsageSummary = {
  runId: 'run-1',
  providerId: 'provider',
  modelId: 'model',
  usagePercent: 2,
  promptBudgetTokens: 1_000_000,
  contextWindowTokens: 1_000_000,
  maxOutputTokens: 384_000,
  compactionThresholdTokens: 800_000,
  inputTokens: 20_000,
  outputTokens: 0,
  totalTokens: 20_000,
  occupiedTokens: 20_000,
  breakdown: null,
  snapshotAt: 1,
};

const prepared: PreparedTurnContextSummary = {
  requestId: 'request-1',
  turnId: 'turn-1',
  route: {
    providerId: 'provider',
    adapterId: 'openai-compatible',
    selectedModelId: 'model',
    effectiveModelId: 'model',
    protocol: 'OpenAICompatibleChatCompletions',
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
  maxOutputTokens: 384_000,
  compactionThresholdTokens: 700_000,
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
};

describe('contextUsageDisplay', () => {
  it('prefers prepared values while a current request is shown', () => {
    expect(resolveDisplayedPromptBudget(true, prepared, usage, profile)).toBe(1_000_000);
    expect(resolveDisplayedMaxOutput(true, prepared, usage, profile)).toBe(384_000);
    expect(resolveDisplayedCompactionThreshold(true, prepared, usage, profile)).toBe(700_000);
  });

  it('falls back to usage then the selected profile', () => {
    expect(resolveDisplayedPromptBudget(false, null, usage, profile)).toBe(1_000_000);
    expect(resolveDisplayedMaxOutput(false, null, null, profile)).toBe(384_000);
    expect(resolveDisplayedCompactionThreshold(false, null, null, profile)).toBe(800_000);
  });

  it('uses the live profile compaction line instead of a stale usage snapshot', () => {
    const tighter = { ...profile, compactionThresholdTokens: 500_000 };
    expect(resolveDisplayedCompactionThreshold(false, null, usage, tighter)).toBe(500_000);
  });

  it('derives remaining generation from the live window and occupied prompt', () => {
    expect(resolveDisplayedGeneratable(false, null, usage, profile)).toBe(384_000);
    expect(resolveDisplayedGeneratable(true, prepared, usage, profile)).toBe(384_000);
  });
});
