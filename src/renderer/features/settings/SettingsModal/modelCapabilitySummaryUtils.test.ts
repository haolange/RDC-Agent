import { describe, expect, it } from 'vitest';
import type { EffectiveModel } from '@shared/types/providerCapability';
import {
  buildCapabilityChips,
  buildCapabilityEvidenceSummary,
  buildContextTierRows,
  formatContextCapability,
  formatFastCapability,
  formatReasoningCapability,
  snapshotMatchesProvider,
} from './modelCapabilitySummaryUtils';

const t = (key: string, params?: Record<string, string | number>): string => {
  const labels: Record<string, string> = {
    'settings.providers.capability.unknown': 'Unknown', 'settings.providers.capability.unsupported': 'Unsupported',
    'settings.providers.capability.unverified': 'Unverified', 'settings.providers.capability.granted': 'Granted',
    'settings.providers.capability.denied': 'Denied', 'settings.providers.capability.route': 'Route',
    'settings.providers.capability.context': 'Context', 'settings.providers.capability.reasoning': 'Reasoning',
    'settings.providers.capability.fastMode': 'Fast', 'settings.providers.capability.toolCalling': 'Tools',
    'settings.providers.capability.visionInput': 'Vision', 'settings.providers.capability.structuredOutput': 'Structured',
    'settings.providers.capability.supported': 'Supported', 'composer.effort.levelOff': 'Off',
    'composer.effort.levelOn': 'On', 'composer.effort.levelLow': 'Low', 'composer.effort.levelMedium': 'Medium',
    'composer.effort.levelHigh': 'High', 'composer.effort.levelExtra': 'Extra', 'composer.effort.levelMax': 'Max',
    'settings.providers.capability.activationImplicit': 'Implicit',
    'settings.providers.capability.activationHeader': 'Header',
    'settings.providers.capability.activationRequest': 'Request parameter',
    'settings.providers.capability.sourceSeed': 'seed',
    'settings.providers.capability.sourceObserved': 'observed',
  };
  if (key === 'settings.providers.capability.lockedValue') return `${params?.value} (Locked)`;
  if (key === 'settings.providers.capability.activationModel') return `Model ${params?.model}`;
  if (key === 'settings.providers.capability.activationWithEntitlement') return `${params?.activation} · ${params?.entitlement}`;
  if (key === 'settings.providers.capability.contextRange') return `${params?.base} -> ${params?.maximum}`;
  if (key === 'settings.providers.capability.contextRangeUnverified') return `${params?.base} -> ${params?.maximum} (Unverified)`;
  if (key === 'settings.providers.capability.maxTierLabel') return `${params?.label} · Max`;
  if (key === 'settings.providers.capability.sources') return `${params?.sources} @ ${params?.date}`;
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
    expect(chips).toContainEqual(expect.objectContaining({ label: 'Fast', value: 'Model model-a-fast' }));
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
    expect(formatReasoningCapability(null, t)).toBe('Unknown');
    expect(formatFastCapability(null, t)).toBe('Unknown');
  });

  it('keeps tier entitlement and activation explicit without a 1M heuristic', () => {
    const effective = model({
      contextTiers: [
        { id: 'default', label: 'Default', maxPromptTokens: 272_000, activation: { kind: 'implicit' }, entitlement: 'granted' },
        { id: 'long', label: 'Long', maxPromptTokens: 922_000, activation: { kind: 'header', headers: { 'x-beta': 'long' } }, entitlement: 'unknown' },
      ],
      fast: { kind: 'request-param', patch: { service_tier: 'priority' }, entitlement: 'unknown' },
    });
    expect(formatContextCapability(effective, t)).toBe('272k -> 922k (Unverified)');
    expect(formatFastCapability(effective, t)).toBe('Request parameter · Unverified');
    expect(buildContextTierRows(effective, t)).toContainEqual(expect.objectContaining({
      id: 'long', label: 'Long · Max', limit: '922k', entitlement: 'Unverified', activation: 'Header', tone: 'warning',
    }));
  });

  it('filters catalog events by provider, account, and protocol', () => {
    const snapshot = {
      providerId: 'provider-a', accountId: 'account-a', protocol: 'AnthropicMessages' as const,
      models: [], generatedAt: '2026-07-13T00:00:00.000Z', stale: false, refreshing: false,
    };
    expect(snapshotMatchesProvider(snapshot, {
      id: 'provider-a', activeAccountId: 'account-a', protocol: 'AnthropicMessages',
    })).toBe(true);
    expect(snapshotMatchesProvider(snapshot, {
      id: 'provider-a', activeAccountId: 'account-b', protocol: 'AnthropicMessages',
    })).toBe(false);
    expect(snapshotMatchesProvider(snapshot, {
      id: 'provider-a', activeAccountId: 'account-a', protocol: 'OpenAIResponses',
    })).toBe(false);
  });

  it('summarizes winning leaf evidence instead of the last arbitrary entry', () => {
    expect(buildCapabilityEvidenceSummary(model({ provenance: [
      { field: 'availability', source: 'seed', observedAt: '2026-07-01T00:00:00.000Z' },
      { field: 'availability', source: 'observed', observedAt: '2026-07-13T00:00:00.000Z' },
      { field: 'fast.kind', source: 'seed', observedAt: '2026-07-01T00:00:00.000Z' },
    ] }), t)).toBe('observed, seed @ 2026-07-13');
  });
});
