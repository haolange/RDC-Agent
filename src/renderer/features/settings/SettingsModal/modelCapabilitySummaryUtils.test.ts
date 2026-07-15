import { describe, expect, it } from 'vitest';
import type { EffectiveModel } from '@shared/types/providerCapability';
import {
  buildCapabilityChips,
  buildCapabilityEvidenceSummary,
  buildContextTierRows,
  formatContextCapability,
  formatFastControl,
  formatReasoningCapability,
  snapshotMatchesProvider,
} from './modelCapabilitySummaryUtils';

const t = (key: string, params?: Record<string, string | number>): string => {
  const labels: Record<string, string> = {
    'settings.providers.capability.unknown': 'Unknown',
    'settings.providers.capability.unsupported': 'Unsupported',
    'settings.providers.capability.unverified': 'Unverified',
    'settings.providers.capability.granted': 'Granted',
    'settings.providers.capability.denied': 'Denied',
    'settings.providers.capability.route': 'Route',
    'settings.providers.capability.context': 'Context',
    'settings.providers.capability.reasoning': 'Reasoning',
    'settings.providers.capability.fastMode': 'Fast',
    'settings.providers.capability.toolCalling': 'Tools',
    'settings.providers.capability.visionInput': 'Vision',
    'settings.providers.capability.structuredOutput': 'Structured',
    'settings.providers.capability.supported': 'Supported',
    'settings.providers.capability.activationImplicit': 'Implicit',
    'settings.providers.capability.activationHeader': 'Header',
    'settings.providers.capability.activationRequest': 'Request parameter',
    'settings.providers.capability.sourceCatalog': 'catalog',
    'settings.providers.capability.sourceObserved': 'observed',
    'composer.effort.providerManaged': 'Provider managed',
    'composer.effort.levelOff': 'Off',
    'composer.effort.levelOn': 'On',
    'composer.effort.levelLow': 'Low',
    'composer.effort.levelMedium': 'Medium',
    'composer.effort.levelHigh': 'High',
    'composer.effort.levelExtra': 'Extra',
    'composer.effort.levelMax': 'Max',
  };
  if (key === 'settings.providers.capability.lockedValue') return `${params?.value} (Locked)`;
  if (key === 'settings.providers.capability.activationModel') return `Model ${params?.model}`;
  if (key === 'settings.providers.capability.activationWithEntitlement') return `${params?.activation} · ${params?.entitlement}`;
  if (key === 'settings.providers.capability.contextRange') return `${params?.base} -> ${params?.maximum}`;
  if (key === 'settings.providers.capability.contextRangeUnverified') return `${params?.base} -> ${params?.maximum} (Unverified)`;
  if (key === 'settings.providers.capability.oneMillionTierLabel') return `${params?.label} · 1M`;
  if (key === 'settings.providers.capability.sources') return `${params?.sources} @ ${params?.date}`;
  return labels[key] ?? key;
};

const reasoning = {
  kind: 'toggle' as const,
  supportsOff: true,
  levels: [],
  defaultSelection: 'on' as const,
  wireProfile: { kind: 'anthropic' as const, on: 'high' as const, onMode: 'enabled' as const, offMode: 'disabled' as const },
};

function model(overrides: Partial<EffectiveModel> = {}): EffectiveModel {
  return {
    providerId: 'provider-a',
    modelId: 'model-a',
    label: 'Model A',
    aliases: [],
    enabled: true,
    route: { protocol: 'AnthropicMessages', source: 'catalog' },
    availability: 'available',
    presencePolicy: 'maintained',
    contextTiers: [{
      id: 'default', label: 'Default', maxPromptTokens: 262_144,
      activation: { kind: 'implicit' }, entitlement: 'granted',
    }],
    defaultBudgetTokens: 262_144,
    controls: {
      fast: { state: 'selectable', defaultValue: false, entitlement: 'granted' },
      context1m: { state: 'unsupported', fixedValue: false },
      reasoning,
    },
    executionBindings: [{
      id: 'fast:model-a-fast', when: { fast: true },
      actions: [{ kind: 'model-switch', targetModelId: 'model-a-fast' }], entitlement: 'granted',
    }],
    resolvedControls: {
      fast: { state: 'selectable', value: false, defaultValue: false, disabled: false, bindingId: 'fast:model-a-fast', effectiveModelId: 'model-a-fast' },
      context1m: { state: 'unsupported', value: false, defaultValue: false, disabled: true },
      reasoning,
    },
    toolCalling: { state: 'supported' },
    visionInput: { state: 'unknown' },
    structuredOutput: { state: 'unknown' },
    provenance: [],
    ...overrides,
  };
}

describe('modelCapabilitySummaryUtils', () => {
  it('formats the revisioned EffectiveModel projection', () => {
    const chips = buildCapabilityChips(model(), t);
    expect(chips).toContainEqual(expect.objectContaining({ label: 'Context', value: '262.1k' }));
    expect(chips).toContainEqual(expect.objectContaining({ label: 'Reasoning', value: 'Off, On' }));
    expect(chips).toContainEqual(expect.objectContaining({ label: 'Fast', value: 'Model model-a-fast' }));
    expect(chips).toContainEqual(expect.objectContaining({ label: 'Tools', value: 'Supported' }));
  });

  it('formats locked, provider-managed and unknown control semantics', () => {
    expect(formatFastControl(model({
      controls: { ...model().controls, fast: { state: 'fixed', fixedValue: true, entitlement: 'granted' } },
    }), t)).toBe('Fast (Locked)');
    expect(formatFastControl(model({
      controls: { ...model().controls, fast: { state: 'provider-managed', fixedValue: true } },
    }), t)).toBe('Provider managed');
    expect(formatReasoningCapability(model({
      controls: {
        ...model().controls,
        reasoning: { kind: 'unknown', supportsOff: false, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } },
      },
    }), t)).toBe('Unverified');
  });

  it('formats fixed always-on reasoning', () => {
    expect(formatReasoningCapability(model({
      controls: {
        ...model().controls,
        reasoning: {
          kind: 'always-on', supportsOff: false, levels: [], defaultSelection: 'on', lockedSelection: 'on',
          wireProfile: { kind: 'anthropic', on: 'high', onMode: 'enabled' },
        },
      },
    }), t)).toBe('On (Locked)');
  });

  it('uses only the explicit 1M tier and keeps entitlement visible', () => {
    const effective = model({
      contextTiers: [
        { id: 'default', label: 'Default', maxPromptTokens: 272_000, activation: { kind: 'implicit' }, entitlement: 'granted' },
        { id: 'long', label: 'Long', maxPromptTokens: 922_000, maxOutputTokens: 128_000, activation: { kind: 'header', headers: { 'x-beta': 'long' } }, entitlement: 'unknown' },
      ],
      controls: {
        ...model().controls,
        context1m: { state: 'selectable', defaultValue: false, entitlement: 'unknown', tierId: 'long' },
      },
    });
    expect(formatContextCapability(effective, t)).toBe('272k -> 1.1M (Unverified)');
    expect(buildContextTierRows(effective, t)).toContainEqual(expect.objectContaining({
      id: 'long', label: 'Long · 1M', entitlement: 'Unverified', activation: 'Header', tone: 'warning',
    }));
  });

  it('does not invent values without an EffectiveModel', () => {
    expect(formatContextCapability(null, t)).toBe('Unknown');
    expect(formatReasoningCapability(null, t)).toBe('Unknown');
    expect(formatFastControl(null, t)).toBe('Unknown');
  });

  it('filters snapshots by provider, account and protocol', () => {
    const snapshot = {
      providerId: 'provider-a', accountId: 'account-a', protocol: 'AnthropicMessages' as const,
      catalogRevision: 'test-catalog', models: [], generatedAt: '2026-07-13T00:00:00.000Z',
      stale: false, refreshing: false,
    };
    expect(snapshotMatchesProvider(snapshot, { id: 'provider-a', activeAccountId: 'account-a', protocol: 'AnthropicMessages' })).toBe(true);
    expect(snapshotMatchesProvider(snapshot, { id: 'provider-a', activeAccountId: 'account-b', protocol: 'AnthropicMessages' })).toBe(false);
  });

  it('summarizes the winning field-level provenance', () => {
    expect(buildCapabilityEvidenceSummary(model({ provenance: [
      { field: 'availability', source: 'catalog', observedAt: '2026-07-01T00:00:00.000Z' },
      { field: 'availability', source: 'observed', observedAt: '2026-07-13T00:00:00.000Z' },
      { field: 'controls.fast.state', source: 'catalog', observedAt: '2026-07-01T00:00:00.000Z' },
    ] }), t)).toBe('observed, catalog @ 2026-07-13');
  });
});
