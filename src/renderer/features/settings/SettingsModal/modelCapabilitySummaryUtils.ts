import type {
  CapabilityEvidenceSource,
  CapabilityState,
  ContextTier,
  EffectiveCatalogSnapshot,
  EffectiveModel,
  EntitlementState,
  TierActivation,
} from '@shared/types/providerCapability';
import {
  getReasoningSelectionOrder,
  type ReasoningControl,
  type ReasoningSelection,
} from '@shared/types/modelCapability';
import type { LlmProviderEntry } from '@shared/types/settings';
import { contextTierWindowTokens, resolveContextTierChoices } from '@shared/utils/contextTiers';
import { formatTokenCount } from '@shared/utils/tokens';
import { formatPricePerMillion } from '@shared/utils/cost';
import type { useI18n } from '../../../i18n';
import { getProviderProtocolLabel } from './utils';

type Translate = ReturnType<typeof useI18n>['t'];

const REASONING_LABEL_KEYS = {
  off: 'composer.effort.levelOff', on: 'composer.effort.levelOn', minimal: 'composer.effort.levelMinimal',
  low: 'composer.effort.levelLow', medium: 'composer.effort.levelMedium', high: 'composer.effort.levelHigh',
  xhigh: 'composer.effort.levelExtra', max: 'composer.effort.levelMax',
} as const satisfies Record<ReasoningSelection, Parameters<Translate>[0]>;

const EVIDENCE_LABEL_KEYS = {
  catalog: 'settings.providers.capability.sourceCatalog',
  discovery: 'settings.providers.capability.sourceDiscovery',
  overlay: 'settings.providers.capability.sourceOverlay',
  entitlement: 'settings.providers.capability.sourceEntitlement',
  observed: 'settings.providers.capability.sourceObserved',
  'maintained-surface': 'settings.providers.capability.sourceMaintainedSurface',
  user: 'settings.providers.capability.sourceUser',
} as const satisfies Record<CapabilityEvidenceSource, Parameters<Translate>[0]>;

export interface CapabilityChip {
  label: string;
  value: string;
  tone?: 'default' | 'muted' | 'positive' | 'warning' | 'negative';
}

export interface ContextTierRow {
  id: string;
  label: string;
  limit: string;
  entitlement: string;
  activation: string;
  cost: string | null;
  tone: CapabilityChip['tone'];
}

export interface ModelPricingRow {
  id: string;
  label: string;
  value: string;
}

export function buildPricingRows(model: EffectiveModel | null, t: Translate): ModelPricingRow[] {
  if (!model?.cost) return [];
  const suffix = t('settings.providers.capability.perMillionTokens');
  const price = (value: number): string => `${formatPricePerMillion(value)} ${suffix}`;
  const rows: ModelPricingRow[] = [
    { id: 'input', label: t('settings.providers.capability.pricingInput'), value: price(model.cost.input) },
    { id: 'output', label: t('settings.providers.capability.pricingOutput'), value: price(model.cost.output) },
  ];
  if (typeof model.cost.cacheRead === 'number') {
    rows.push({ id: 'cacheRead', label: t('settings.providers.capability.pricingCacheRead'), value: price(model.cost.cacheRead) });
  }
  if (typeof model.cost.cacheWrite === 'number') {
    rows.push({ id: 'cacheWrite', label: t('settings.providers.capability.pricingCacheWrite'), value: price(model.cost.cacheWrite) });
  }
  return rows;
}

export function snapshotMatchesProvider(
  snapshot: EffectiveCatalogSnapshot,
  provider: Pick<LlmProviderEntry, 'id' | 'activeAccountId' | 'protocol'>,
  discoveryAccountId?: string | null,
): boolean {
  const accountId = discoveryAccountId?.trim()
    || provider.activeAccountId
    || `anonymous:${provider.id}`;
  return snapshot.providerId === provider.id
    && snapshot.accountId === accountId
    && snapshot.protocol === provider.protocol;
}

export function getReasoningLabelKey(level: ReasoningSelection): typeof REASONING_LABEL_KEYS[ReasoningSelection] {
  return REASONING_LABEL_KEYS[level];
}

export function findEffectiveCapabilityModel(
  snapshot: EffectiveCatalogSnapshot | null,
  modelId: string,
): EffectiveModel | null {
  return snapshot?.models.find((model) => model.modelId === modelId || model.aliases.includes(modelId)) ?? null;
}

function formatTierLimit(tier: ContextTier | undefined, t: Translate): string {
  const cap = tier ? contextTierWindowTokens(tier) : undefined;
  return cap ? formatTokenCount(cap) : t('settings.providers.capability.unknown');
}

function formatEntitlement(entitlement: EntitlementState, t: Translate): string {
  if (entitlement === 'granted') return t('settings.providers.capability.granted');
  if (entitlement === 'denied') return t('settings.providers.capability.denied');
  return t('settings.providers.capability.unverified');
}

function formatActivation(activation: TierActivation, t: Translate): string {
  switch (activation.kind) {
    case 'header': return t('settings.providers.capability.activationHeader');
    case 'body': return t('settings.providers.capability.activationBody');
    case 'implicit':
    default: return t('settings.providers.capability.activationImplicit');
  }
}

export function formatContextCapability(model: EffectiveModel | null, t: Translate): string {
  if (!model) return t('settings.providers.capability.unknown');
  const choices = resolveContextTierChoices(model);
  const normal = formatTierLimit(choices.normalTier, t);
  if (!choices.maxTier) return normal;
  if (choices.maxTier.id === choices.normalTier?.id) {
    return choices.maxTierUnverified
      ? t('settings.providers.capability.contextMaxUnverified', { window: normal })
      : t('settings.providers.capability.contextMax', { window: normal });
  }
  const maxTierLimit = formatTierLimit(choices.maxTier, t);
  return choices.maxTierUnverified
    ? t('settings.providers.capability.contextRangeUnverified', { base: normal, maximum: maxTierLimit })
    : t('settings.providers.capability.contextRange', { base: normal, maximum: maxTierLimit });
}

export function buildContextTierRows(model: EffectiveModel | null, t: Translate): ContextTierRow[] {
  if (!model) return [];
  const choices = resolveContextTierChoices(model);
  return model.contextTiers.map((tier) => ({
    id: tier.id,
    label: tier.id === choices.maxTier?.id
      ? t('settings.providers.capability.maxTierLabel', { label: tier.label })
      : tier.label,
    limit: formatTierLimit(tier, t),
    entitlement: formatEntitlement(tier.entitlement, t),
    activation: formatActivation(tier.activation, t),
    cost: typeof tier.costMultiplier === 'number'
      ? t('settings.providers.capability.costMultiplier', { multiplier: tier.costMultiplier })
      : null,
    tone: tier.entitlement === 'granted' ? 'positive' : tier.entitlement === 'denied' ? 'negative' : 'warning',
  }));
}

export function formatReasoningCapabilityValue(control: ReasoningControl | null, t: Translate): string {
  if (!control) return t('settings.providers.capability.unknown');
  if (control.kind === 'unknown') return t('composer.effort.levelOff');
  const levels = getReasoningSelectionOrder(control);
  if (levels.length === 0 || (levels.length === 1 && levels[0] === 'off' && control.kind === 'none')) {
    return t('composer.effort.levelOff');
  }
  const base = levels.map((level) => t(REASONING_LABEL_KEYS[level])).join(', ');
  return control.kind === 'always-on' ? t('settings.providers.capability.lockedValue', { value: base }) : base;
}

export function formatReasoningCapability(model: EffectiveModel | null, t: Translate): string {
  return formatReasoningCapabilityValue(model?.controls.reasoning ?? null, t);
}

export function formatFastControl(model: EffectiveModel | null, t: Translate): string {
  if (!model || model.controls.fast.state === 'unknown') return t('settings.providers.capability.unknown');
  if (model.controls.fast.state === 'unsupported') return t('settings.providers.capability.unsupported');
  if (model.controls.fast.state === 'provider-managed') return t('composer.effort.providerManaged');
  if (model.controls.fast.state === 'fixed') {
    const activation = t('settings.providers.capability.lockedValue', {
      value: t('settings.providers.capability.fastMode'),
    });
    return !model.controls.fast.entitlement || model.controls.fast.entitlement === 'granted'
      ? activation
      : t('settings.providers.capability.activationWithEntitlement', {
          activation,
          entitlement: formatEntitlement(model.controls.fast.entitlement, t),
        });
  }
  const bindingId = model.resolvedControls?.fast.bindingId;
  const binding = model.executionBindings?.find((candidate) => candidate.id === bindingId)
    ?? model.executionBindings?.find((candidate) => candidate.when.fast === true);
  const action = binding?.actions.find((candidate) => candidate.kind !== 'fixed');
  const activation = model.controls.fast.label ?? (action?.kind === 'model-switch'
    ? t('settings.providers.capability.activationModel', { model: action.targetModelId })
    : action?.kind === 'client-tier'
      ? t('settings.providers.capability.activationClientTier', { tier: action.tierId })
      : action?.kind === 'unsupported'
        ? t('settings.providers.capability.unsupported')
        : t('settings.providers.capability.activationRequest'));
  return model.controls.fast.entitlement === 'granted'
    ? activation
    : t('settings.providers.capability.activationWithEntitlement', {
        activation,
        entitlement: formatEntitlement(model.controls.fast.entitlement, t),
      });
}

export function formatCapabilityState(state: CapabilityState | undefined, t: Translate): string {
  if (!state || state.state === 'unknown') return t('settings.providers.capability.unknown');
  return state.state === 'supported'
    ? t('settings.providers.capability.supported')
    : t('settings.providers.capability.unsupported');
}

function stateTone(state: CapabilityState | undefined): CapabilityChip['tone'] {
  if (!state || state.state === 'unknown') return 'warning';
  return state.state === 'supported' ? 'positive' : 'negative';
}

function formatToolCallingState(state: CapabilityState | undefined, t: Translate): string {
  if (!state || state.state === 'unknown') return t('settings.providers.capability.unverified');
  return formatCapabilityState(state, t);
}

function toolCallingTone(state: CapabilityState | undefined): CapabilityChip['tone'] {
  if (!state || state.state === 'unknown') return 'default';
  return stateTone(state);
}

export function buildCapabilityChips(model: EffectiveModel | null, t: Translate): CapabilityChip[] {
  const context = formatContextCapability(model, t);
  const fast = formatFastControl(model, t);
  const fastState = model?.resolvedControls?.fast.state ?? model?.controls.fast.state;
  const fastTone = !model || fastState === 'unknown' || fastState === 'provider-managed'
    ? 'warning'
    : fastState === 'unsupported' || fastState === 'blocked'
      ? 'negative'
      : model.controls.fast.state === 'selectable' && model.controls.fast.entitlement === 'denied'
          ? 'negative'
          : model.controls.fast.state === 'selectable' && model.controls.fast.entitlement === 'unknown'
            ? 'warning'
            : 'positive';
  return [
    {
      label: t('settings.providers.capability.route'),
      value: model ? (model.route.source === 'model'
        ? t('settings.providers.capability.modelRoute', { protocol: getProviderProtocolLabel(model.route.protocol) })
        : getProviderProtocolLabel(model.route.protocol)) : t('settings.providers.capability.unknown'),
      tone: model?.route.source === 'model' ? 'positive' : 'default',
    },
    { label: t('settings.providers.capability.context'), value: context, tone: context === t('settings.providers.capability.unknown') ? 'warning' : 'positive' },
    {
      label: t('settings.providers.capability.reasoning'),
      value: formatReasoningCapability(model, t),
      tone: model?.controls.reasoning.kind === 'unknown'
        ? 'default'
        : model?.controls.reasoning.kind === 'none'
          ? 'negative'
          : model ? 'positive' : 'warning',
    },
    { label: t('settings.providers.capability.fastMode'), value: fast, tone: fastTone },
    { label: t('settings.providers.capability.toolCalling'), value: formatToolCallingState(model?.toolCalling, t), tone: toolCallingTone(model?.toolCalling) },
    { label: t('settings.providers.capability.visionInput'), value: formatCapabilityState(model?.visionInput, t), tone: stateTone(model?.visionInput) },
    { label: t('settings.providers.capability.structuredOutput'), value: formatCapabilityState(model?.structuredOutput, t), tone: stateTone(model?.structuredOutput) },
  ];
}

export function buildCapabilityEvidenceSummary(model: EffectiveModel | null, t: Translate): string {
  if (!model?.provenance.length) return t('settings.providers.capability.conservativeDefault');
  const winners = new Map(model.provenance.map((evidence) => [evidence.field, evidence]));
  const evidence = [...winners.values()];
  const sources = [...new Set(evidence.map((entry) => entry.source))]
    .map((source) => t(EVIDENCE_LABEL_KEYS[source]))
    .join(', ');
  const latest = evidence.map((entry) => entry.observedAt).sort().at(-1)?.slice(0, 10) ?? '';
  return t('settings.providers.capability.sources', { sources, date: latest });
}
