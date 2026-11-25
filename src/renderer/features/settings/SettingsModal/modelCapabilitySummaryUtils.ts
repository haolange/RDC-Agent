import {
  getReasoningSelectionOrder,
  type ReasoningControl,
  type ReasoningSelection,
} from '@shared/types/modelCapability';
import { contextTierWindowTokens, resolveContextTierChoices } from '@shared/utils/contextTiers';
import { formatTokenCount } from '@shared/utils/tokens';
import { formatPricePerMillion } from '@shared/utils/cost';
import type { useI18n } from '../../../i18n';
import type {
  CapabilityState,
  ContextTier,
  EffectiveCatalogSnapshot,
  EffectiveModel,
  EntitlementState,
} from '@shared/types/providerCapability';

type Translate = ReturnType<typeof useI18n>['t'];

const REASONING_LABEL_KEYS = {
  off: 'composer.effort.levelOff', on: 'composer.effort.levelOn', minimal: 'composer.effort.levelMinimal',
  low: 'composer.effort.levelLow', medium: 'composer.effort.levelMedium', high: 'composer.effort.levelHigh',
  xhigh: 'composer.effort.levelExtra', max: 'composer.effort.levelMax',
} as const satisfies Record<ReasoningSelection, Parameters<Translate>[0]>;

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
    cost: typeof tier.costMultiplier === 'number'
      ? t('settings.providers.capability.costMultiplier', { multiplier: tier.costMultiplier })
      : null,
    tone: tier.entitlement === 'granted' ? 'positive' : tier.entitlement === 'denied' ? 'negative' : 'warning',
  }));
}

export function formatReasoningCapabilityValue(control: ReasoningControl | null, t: Translate): string {
  if (!control) return t('settings.providers.capability.unknown');
  if (control.kind === 'unknown') return t('settings.providers.capability.unknown');
  const levels = getReasoningSelectionOrder(control);
  if (levels.length === 0 || (levels.length === 1 && levels[0] === 'off' && control.kind === 'none')) {
    return t('composer.effort.levelOff');
  }
  const base = levels.map((level) => t(REASONING_LABEL_KEYS[level])).join(', ');
  return control.kind === 'always-on' ? t('settings.providers.capability.lockedValue', { value: base }) : base;
}

export function formatReasoningDefault(control: ReasoningControl | null, t: Translate): string {
  if (!control || control.kind === 'unknown' || control.defaultState === 'unknown') {
    return t('settings.providers.capability.unknown');
  }
  if (control.defaultState === 'provider-managed') return t('composer.effort.providerManaged');
  return t('settings.providers.capability.providerDefault', {
    value: t(getReasoningLabelKey(control.defaultSelection ?? 'off')),
  });
}

export function formatReasoningCapability(model: EffectiveModel | null, t: Translate): string {
  return formatReasoningCapabilityValue(model?.controls.reasoning ?? null, t);
}

/** Whether fast mode is there for this model, in one word; how it is switched on is not the person's concern. */
export function formatFastControl(model: EffectiveModel | null, t: Translate): string {
  if (!model || model.controls.fast.state === 'unknown') return t('settings.providers.capability.unknown');
  if (model.controls.fast.state === 'unsupported') return t('settings.providers.capability.unsupported');
  if (model.controls.fast.state === 'provider-managed') return t('composer.effort.providerManaged');
  if (model.controls.fast.state === 'fixed') return t('settings.providers.capability.alwaysOn');
  const entitlement = model.controls.fast.entitlement;
  return !entitlement || entitlement === 'granted'
    ? t('settings.providers.capability.supported')
    : formatEntitlement(entitlement, t);
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
  if (!state || state.state === 'unknown') return 'warning';
  return stateTone(state);
}

export function buildCapabilityChips(model: EffectiveModel | null, t: Translate): CapabilityChip[] {
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
