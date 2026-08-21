import { describe, expect, it } from 'vitest';
import type { RunContextUsageSummary } from '@shared/types/session';
import type { SelectedContextProfile } from './selectedContextProfile';
import {
  projectContextUsagePreview,
  shouldProjectContextUsagePreview,
} from './projectContextUsagePreview';

const usage = (overrides: Partial<RunContextUsageSummary> = {}): RunContextUsageSummary => ({
  runId: 'run-1',
  providerId: 'provider-a',
  modelId: 'model-256k',
  usagePercent: 45,
  promptBudgetTokens: 256_000,
  contextWindowTokens: 256_000,
  maxOutputTokens: 0,
  compactionThresholdTokens: 204_800,
  inputTokens: 115_200,
  outputTokens: 1_000,
  totalTokens: 116_200,
  occupiedTokens: 115_200,
  breakdown: [
    { id: 'conversation', tokens: 80_000 },
    { id: 'system_prompt', tokens: 35_200 },
    { id: 'free', tokens: 140_800 },
  ],
  snapshotAt: 1,
  ...overrides,
});

const profile = (overrides: Partial<SelectedContextProfile> = {}): SelectedContextProfile => ({
  providerId: 'provider-a',
  modelId: 'model-1m',
  contextWindowTokens: 1_000_000,
  contextBudgetTokens: 1_000_000,
  maxOutputTokens: 0,
  compactionThresholdTokens: 800_000,
  ...overrides,
});

describe('projectContextUsagePreview', () => {
  it('projects occupancy onto a new model budget without rewriting occupied tokens', () => {
    const result = projectContextUsagePreview(usage(), profile(), 'idle');
    expect(result.estimated).toBe(true);
    expect(result.usage?.occupiedTokens).toBe(115_200);
    expect(result.usage?.promptBudgetTokens).toBe(1_000_000);
    expect(result.usage?.contextWindowTokens).toBe(1_000_000);
    expect(result.usage?.maxOutputTokens).toBe(0);
    expect(result.usage?.compactionThresholdTokens).toBe(800_000);
    expect(result.usage?.usagePercent).toBe(12);
    expect(result.usage?.breakdown).toEqual([
      { id: 'conversation', tokens: 80_000 },
      { id: 'system_prompt', tokens: 35_200 },
      { id: 'free', tokens: 884_800 },
    ]);
    expect(result.usage?.providerId).toBe('provider-a');
    expect(result.usage?.modelId).toBe('model-256k');
  });

  it('inserts a rescaled free segment when the last snapshot omitted one', () => {
    const result = projectContextUsagePreview(usage({
      breakdown: [{ id: 'conversation', tokens: 80_000 }],
    }), profile(), 'idle');
    expect(result.usage?.breakdown).toEqual([
      { id: 'conversation', tokens: 80_000 },
      { id: 'free', tokens: 884_800 },
    ]);
  });

  it('keeps the projected snapshot during preparing so the ring does not snap back', () => {
    const result = projectContextUsagePreview(usage(), profile(), 'preparing');
    expect(result.estimated).toBe(true);
    expect(result.usage?.promptBudgetTokens).toBe(1_000_000);
    expect(result.usage?.contextWindowTokens).toBe(1_000_000);
    expect(result.usage?.usagePercent).toBe(12);
  });

  it('projects when only the context budget changes on the same model', () => {
    const sameModel = profile({ modelId: 'model-256k' });
    expect(shouldProjectContextUsagePreview(usage(), sameModel)).toBe(true);
    const result = projectContextUsagePreview(usage(), sameModel, 'actual');
    expect(result.estimated).toBe(true);
    expect(result.usage?.usagePercent).toBe(12);
  });

  it('does not project when provider, model, and budget already match', () => {
    const matching = profile({
      modelId: 'model-256k',
      contextWindowTokens: 256_000,
      contextBudgetTokens: 256_000,
      compactionThresholdTokens: 204_800,
    });
    const source = usage();
    const result = projectContextUsagePreview(source, matching, 'idle');
    expect(result.estimated).toBe(false);
    expect(result.usage).toBe(source);
  });

  it('projects when only the compaction threshold changes on the same model', () => {
    const tighter = profile({
      modelId: 'model-256k',
      contextWindowTokens: 256_000,
      contextBudgetTokens: 256_000,
      compactionThresholdTokens: 128_000,
    });
    expect(shouldProjectContextUsagePreview(usage(), tighter)).toBe(true);
    const result = projectContextUsagePreview(usage(), tighter, 'idle');
    expect(result.estimated).toBe(true);
    expect(result.usage?.compactionThresholdTokens).toBe(128_000);
    expect(result.usage?.occupiedTokens).toBe(115_200);
  });

  it('defers to the current prepared phase', () => {
    const source = usage();
    expect(projectContextUsagePreview(source, profile(), 'current')).toEqual({
      usage: source,
      estimated: false,
    });
  });

  it('keeps a null breakdown null after projection', () => {
    const result = projectContextUsagePreview(usage({ breakdown: null }), profile(), 'idle');
    expect(result.estimated).toBe(true);
    expect(result.usage?.breakdown).toBeNull();
  });

  it('projects onto a larger prompt budget while preserving the full window', () => {
    const deepseek = profile({
      modelId: 'deepseek-v4-flash',
      contextWindowTokens: 1_000_000,
      contextBudgetTokens: 1_000_000,
      maxOutputTokens: 384_000,
      compactionThresholdTokens: 800_000,
    });
    const result = projectContextUsagePreview(usage(), deepseek, 'idle');
    expect(result.estimated).toBe(true);
    expect(result.usage?.promptBudgetTokens).toBe(1_000_000);
    expect(result.usage?.contextWindowTokens).toBe(1_000_000);
    expect(result.usage?.maxOutputTokens).toBe(384_000);
    expect(result.usage?.compactionThresholdTokens).toBe(800_000);
    expect(result.usage?.usagePercent).toBe(12);
  });
});
