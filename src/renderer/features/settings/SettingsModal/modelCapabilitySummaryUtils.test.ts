import { describe, expect, it } from 'vitest';
import {
  buildCapabilityChips,
  findManagedCapabilityEntry,
  formatContextCapability,
  formatReasoningCapability,
  formatFastCapability,
} from './modelCapabilitySummaryUtils';

const t = (key: string, params?: Record<string, string | number>): string => {
  if (key === 'settings.providers.capability.unknown') return 'Unknown';
  if (key === 'settings.providers.capability.notAvailable') return 'None';
  if (key === 'settings.providers.capability.context') return 'Context';
  if (key === 'settings.providers.capability.reasoning') return 'Reasoning';
  if (key === 'settings.providers.capability.fastMode') return 'Fast';
  if (key === 'settings.providers.capability.toolCalling') return 'Tools';
  if (key === 'settings.providers.capability.visionInput') return 'Vision';
  if (key === 'settings.providers.capability.structuredOutput') return 'Structured';
  if (key === 'settings.providers.capability.supported') return 'Supported';
  if (key === 'composer.effort.levelLow') return 'Low';
  if (key === 'composer.effort.levelOff') return 'Off';
  if (key === 'composer.effort.levelAuto') return 'Auto';
  if (key === 'composer.effort.levelMedium') return 'Medium';
  if (key === 'composer.effort.levelHigh') return 'High';
  if (key === 'composer.effort.levelExtHigh') return 'ExtHigh';
  if (key === 'composer.effort.levelMax') return 'Max';
  return params ? `${key}:${JSON.stringify(params)}` : key;
};

describe('modelCapabilitySummaryUtils', () => {
  it('finds provider-aware managed catalog entries', () => {
    const entry = findManagedCapabilityEntry('anthropic', 'app-managed', 'claude-sonnet-5');

    expect(entry?.id).toBe('claude-sonnet-5');
    expect(entry?.profile.nominalContextWindowTokens).toBe(1_000_000);
  });

  it('does not leak app-managed capabilities into user-managed providers', () => {
    const entry = findManagedCapabilityEntry('openrouter', 'user-managed', 'claude-sonnet-5');

    expect(entry).toBeNull();
  });

  it('formats first-version catalog capability chips', () => {
    const entry = findManagedCapabilityEntry('kimi-coding-plan', 'app-managed', 'kimi-for-coding');
    expect(entry).not.toBeNull();

    const chips = buildCapabilityChips(entry, t);
    expect(chips).toContainEqual(expect.objectContaining({ label: 'Context', value: '262.1k' }));
    expect(chips).toContainEqual(expect.objectContaining({ label: 'Reasoning', value: 'Off, Auto' }));
    expect(chips).toContainEqual(expect.objectContaining({ label: 'Fast', value: 'None' }));
    expect(chips).toContainEqual(expect.objectContaining({ label: 'Tools', value: 'Supported' }));
  });

  it('formats conservative default values without override semantics', () => {
    expect(formatContextCapability(null, t)).toBe('Unknown');
    expect(formatReasoningCapability(null, t)).toBe('None');
    expect(formatFastCapability(null, t)).toBe('None');
  });
});
