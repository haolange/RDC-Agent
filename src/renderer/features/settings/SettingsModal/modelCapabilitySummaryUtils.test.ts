import { describe, expect, it } from 'vitest';
import type { EffectiveModel } from '@shared/types/providerCapability';
import { buildCapabilityChips, formatContextCapability, formatFastCapability, formatReasoningCapability } from './modelCapabilitySummaryUtils';

const t = (key: string, params?: Record<string, string | number>): string => {
  const labels: Record<string, string> = {
    'settings.providers.capability.unknown': 'Unknown', 'settings.providers.capability.notAvailable': 'None',
    'settings.providers.capability.context': 'Context', 'settings.providers.capability.reasoning': 'Reasoning',
    'settings.providers.capability.fastMode': 'Fast', 'settings.providers.capability.toolCalling': 'Tools',
    'settings.providers.capability.visionInput': 'Vision', 'settings.providers.capability.structuredOutput': 'Structured',
    'settings.providers.capability.supported': 'Supported', 'composer.effort.levelOff': 'Off',
    'composer.effort.levelOn': 'On', 'composer.effort.levelLow': 'Low', 'composer.effort.levelMedium': 'Medium',
    'composer.effort.levelHigh': 'High', 'composer.effort.levelExtra': 'Extra', 'composer.effort.levelMax': 'Max',
  };
  if (key === 'settings.providers.capability.lockedValue') return `${params?.value} (Locked)`;
  return labels[key] ?? key;
};

function model(overrides: Partial<EffectiveModel> = {}): EffectiveModel {
  return {
    providerId: 'provider-a', modelId: 'model-a', label: 'Model A', aliases: [], enabled: true,
    route: { protocol: 'AnthropicMessages', source: 'preset' }, availability: 'available',
    contextTiers: [{ id: 'default', label: 'Default', maxPromptTokens: 262_144, activation: { kind: 'implicit' }, entitlement: 'granted' }],
    defaultBudgetTokens: 262_144,
    fast: { kind: 'model-variant', modelId: 'model-a-fast', entitlement: 'granted' },
    reasoning: { kind: 'toggle', supportsOff: true, levels: [], defaultSelection: 'on', wireProfile: { kind: 'anthropic', on: 'high', onMode: 'enabled', offMode: 'disabled' } },
    toolCalling: { state: 'supported' }, visionInput: { state: 'unknown' }, structuredOutput: { state: 'unknown' },
    provenance: [], ...overrides,
  };
}

describe('modelCapabilitySummaryUtils', () => {
  it('formats the EffectiveModel rather than a renderer static catalog', () => {
    const chips = buildCapabilityChips(model(), t);
    expect(chips).toContainEqual(expect.objectContaining({ label: 'Context', value: '262.1k' }));
    expect(chips).toContainEqual(expect.objectContaining({ label: 'Reasoning', value: 'Off, On' }));
    expect(chips).toContainEqual(expect.objectContaining({ label: 'Fast', value: 'model-a-fast' }));
    expect(chips).toContainEqual(expect.objectContaining({ label: 'Tools', value: 'Supported' }));
  });

  it('formats locked and multi-level reasoning from effective controls', () => {
    expect(formatReasoningCapability(model({
      reasoning: { kind: 'always-on', supportsOff: false, levels: [], defaultSelection: 'on', lockedSelection: 'on', wireProfile: { kind: 'anthropic', on: 'high', onMode: 'enabled' } },
    }), t)).toBe('On (Locked)');
    expect(formatReasoningCapability(model({
      reasoning: { kind: 'levels', supportsOff: true, levels: ['low', 'medium', 'high', 'extra'], defaultSelection: 'medium', wireProfile: { kind: 'openai-responses', on: 'medium', levels: { low: 'low', medium: 'medium', high: 'high', extra: 'xhigh' } } },
    }), t)).toBe('Off, Low, Medium, High, Extra');
  });

  it('formats conservative default values without static fallback', () => {
    expect(formatContextCapability(null, t)).toBe('Unknown');
    expect(formatReasoningCapability(null, t)).toBe('None');
    expect(formatFastCapability(null, t)).toBe('None');
  });
});
