import { describe, expect, it } from 'vitest';
import {
  buildCapabilityChips,
  buildContextTierRows,
  formatContextCapability,
  formatFastControl,
  formatReasoningCapability,
  formatReasoningDefault,
  snapshotMatchesProvider,
} from './modelCapabilitySummaryUtils';
import type { EffectiveModel } from '@shared/types/providerCapability';

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
    'settings.providers.capability.alwaysOn': 'Always on',
    'composer.effort.providerManaged': 'Provider-managed',
    'composer.effort.levelOff': 'Off',
    'composer.effort.levelOn': 'On',
    'composer.effort.levelLow': 'Low',
    'composer.effort.levelMedium': 'Medium',
    'composer.effort.levelHigh': 'High',
    'composer.effort.levelExtra': 'Extra',
    'composer.effort.levelMax': 'Max',
  };
  if (key === 'settings.providers.capability.providerDefault') return `Provider default (${params?.value})`;
  if (key === 'settings.providers.capability.lockedValue') return `${params?.value} (Locked)`;
  if (key === 'settings.providers.capability.contextRange') return `${params?.base} -> ${params?.maximum}`;
  if (key === 'settings.providers.capability.contextRangeUnverified') return `${params?.base} -> ${params?.maximum} (Unverified)`;
  if (key === 'settings.providers.capability.maxTierLabel') return `${params?.label} · Max mode`;
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
      maxContext: { state: 'unsupported', fixedValue: false },
      reasoning,
    },
    executionBindings: [{
      id: 'fast:model-a-fast', when: { fast: true },
      actions: [{ kind: 'model-switch', targetModelId: 'model-a-fast' }], entitlement: 'granted',
    }],
    resolvedControls: {
      fast: { state: 'selectable', value: false, defaultValue: false, disabled: false, bindingId: 'fast:model-a-fast', effectiveModelId: 'model-a-fast' },
      maxContext: { state: 'unsupported', value: false, defaultValue: false, disabled: true },
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
  it('says what a model can do without how the catalog learned it or how a control is wired', () => {
    const chips = buildCapabilityChips(model(), t);
    expect(chips).toContainEqual(expect.objectContaining({ label: 'Reasoning', value: 'Off, On' }));
    expect(chips).toContainEqual(expect.objectContaining({ label: 'Fast', value: 'Supported' }));
    expect(chips).toContainEqual(expect.objectContaining({ label: 'Tools', value: 'Supported' }));
    // The model row already carries the context size; the route is not a capability.
    expect(chips.map((chip) => chip.label)).not.toContain('Context');
    expect(chips.map((chip) => chip.label)).not.toContain('Route');
    expect(chips.map((chip) => chip.value).join(' ')).not.toMatch(/model-a-fast|Header|Request/u);
  });

  it('formats locked, provider-managed and unknown control semantics distinctly', () => {
    expect(formatFastControl(model({
      controls: { ...model().controls, fast: { state: 'fixed', fixedValue: true, entitlement: 'granted' } },
    }), t)).toBe('Always on');
    expect(formatFastControl(model({
      controls: { ...model().controls, fast: { state: 'provider-managed', fixedValue: true } },
    }), t)).toBe('Provider-managed');
    expect(formatReasoningCapability(model({
      controls: {
        ...model().controls,
        reasoning: { kind: 'unknown', supportsOff: false, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } },
      },
    }), t)).toBe('Unknown');
  });

  it('keeps unknown and provider-managed defaults distinct from an explicit Off default', () => {
    const unknown = { kind: 'unknown' as const, supportsOff: false, levels: [], defaultSelection: 'off' as const, wireProfile: { kind: 'none' as const } };
    expect(formatReasoningDefault(unknown, t)).toBe('Unknown');
    expect(formatReasoningDefault({ ...reasoning, defaultState: 'unknown' }, t)).toBe('Unknown');
    expect(formatReasoningDefault({ ...reasoning, defaultState: 'provider-managed' }, t)).toBe('Provider-managed');
    expect(formatReasoningDefault({ ...reasoning, defaultSelection: 'off' }, t)).toBe('Provider default (Off)');
    expect(formatReasoningCapability(model({ controls: { ...model().controls, reasoning: { ...unknown, kind: 'none' } } }), t)).toBe('Off');
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
        maxContext: { state: 'selectable', defaultValue: false, entitlement: 'unknown', tierId: 'long' },
      },
    });
    expect(formatContextCapability(effective, t)).toBe('272k -> 1.1M (Unverified)');
    expect(buildContextTierRows(effective, t)).toContainEqual(expect.objectContaining({
      id: 'long', label: 'Long · Max mode', entitlement: 'Unverified', tone: 'warning',
    }));
    expect(buildContextTierRows(effective, t).find((row) => row.id === 'long')).not.toHaveProperty('activation');
  });

  it('does not invent values without an EffectiveModel', () => {
    expect(formatContextCapability(null, t)).toBe('Unknown');
    expect(formatReasoningCapability(null, t)).toBe('Unknown');
    expect(formatFastControl(null, t)).toBe('Unknown');
  });

  it('filters snapshots by provider, account and protocol', () => {
    const snapshot = {
      providerId: 'provider-a', accountId: 'account-a', protocol: 'AnthropicMessages' as const,
      scopeGeneration: 'fixture', projectionVersion: 1,
      catalogRevision: 'test-catalog', models: [], generatedAt: '2026-07-13T00:00:00.000Z',
      stale: false, refreshing: false,
    };
    expect(snapshotMatchesProvider(snapshot, { id: 'provider-a', activeAccountId: 'account-a', protocol: 'AnthropicMessages' })).toBe(true);
    expect(snapshotMatchesProvider(snapshot, { id: 'provider-a', activeAccountId: 'account-b', protocol: 'AnthropicMessages' })).toBe(false);
    expect(snapshotMatchesProvider(
      snapshot,
      { id: 'provider-a', activeAccountId: 'account-b', protocol: 'AnthropicMessages' },
      'account-a',
    )).toBe(true);
  });
});
