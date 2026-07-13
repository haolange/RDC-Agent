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
import { contextTierPromptCap, resolveContextTierChoices } from '@shared/utils/contextTiers';
import { formatTokenCount } from '@shared/utils/tokens';
import type { useI18n } from '../../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];

const REASONING_LABEL_KEYS = {
  off: 'composer.effort.levelOff', on: 'composer.effort.levelOn', minimal: 'composer.effort.levelMinimal',
  low: 'composer.effort.levelLow', medium: 'composer.effort.levelMedium', high: 'composer.effort.levelHigh',
  extra: 'composer.effort.levelExtra', max: 'composer.effort.levelMax', ultra: 'composer.effort.levelUltra',
} as const satisfies Record<ReasoningSelection, Parameters<Translate>[0]>;

const EVIDENCE_LABEL_KEYS = {
  seed: 'settings.providers.capability.sourceSeed',
  discovery: 'settings.providers.capability.sourceDiscovery',
  overlay: 'settings.providers.capability.sourceOverlay',
  entitlement: 'settings.providers.capability.sourceEntitlement',
  observed: 'settings.providers.capability.sourceObserved',
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

export function snapshotMatchesProvider(
  snapshot: EffectiveCatalogSnapshot,
  provider: Pick<LlmProviderEntry, 'id' | 'activeAccountId' | 'protocol'>,
): boolean {
  return snapshot.providerId === provider.id
    && snapshot.accountId === (provider.activeAccountId ?? `anonymous:${provider.id}`)
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
  const cap = tier ? contextTierPromptCap(tier) : undefined;
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
    case 'model-variant': return t('settings.providers.capability.activationModel', { model: activation.modelId });
    case 'implicit':
    default: return t('settings.providers.capability.activationImplicit');
  }
}

export function formatContextCapability(model: EffectiveModel | null, t: Translate): string {
  if (!model) return t('settings.providers.capability.unknown');
  const choices = resolveContextTierChoices(model);
  const base = formatTierLimit(choices.baseTier, t);
  if (!choices.maxTier) return base;
  const maximum = formatTierLimit(choices.maxTier, t);
  return choices.maxTierUnverified
    ? t('settings.providers.capability.contextRangeUnverified', { base, maximum })
    : t('settings.providers.capability.contextRange', { base, maximum });
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
  const levels = getReasoningSelectionOrder(control);
  if (levels.length === 0 || (levels.length === 1 && levels[0] === 'off' && control.kind === 'none')) {
    return t('settings.providers.capability.unsupported');
  }
  const base = levels.map((level) => t(REASONING_LABEL_KEYS[level])).join(', ');
  return control.kind === 'always-on' ? t('settings.providers.capability.lockedValue', { value: base }) : base;
}

export function formatReasoningCapability(model: EffectiveModel | null, t: Translate): string {
  return formatReasoningCapabilityValue(model?.reasoning ?? null, t);
}

export function formatFastCapability(model: EffectiveModel | null, t: Translate): string {
  if (!model || model.fast.kind === 'unknown') return t('settings.providers.capability.unknown');
  if (model.fast.kind === 'unsupported') return t('settings.providers.capability.unsupported');
  const activation = model.fast.label ?? (model.fast.kind === 'model-variant'
    ? t('settings.providers.capability.activationModel', { model: model.fast.modelId })
    : model.fast.kind === 'client-tier'
      ? t('settings.providers.capability.activationClientTier', { tier: model.fast.tierId })
      : t('settings.providers.capability.activationRequest'));
  return model.fast.entitlement === 'granted'
    ? activation
    : t('settings.providers.capability.activationWithEntitlement', {
        activation,
        entitlement: formatEntitlement(model.fast.entitlement, t),
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

export function buildCapabilityChips(model: EffectiveModel | null, t: Translate): CapabilityChip[] {
  const context = formatContextCapability(model, t);
  const fast = formatFastCapability(model, t);
  const fastTone = !model || model.fast.kind === 'unknown'
    ? 'warning'
    : model.fast.kind === 'unsupported' || model.fast.entitlement === 'denied'
      ? 'negative'
      : model.fast.entitlement === 'unknown' ? 'warning' : 'positive';
  return [
    {
      label: t('settings.providers.capability.route'),
      value: model ? (model.route.source === 'model'
        ? t('settings.providers.capability.modelRoute', { protocol: model.route.protocol })
        : model.route.protocol) : t('settings.providers.capability.unknown'),
      tone: model?.route.source === 'model' ? 'positive' : 'default',
    },
    { label: t('settings.providers.capability.context'), value: context, tone: context === t('settings.providers.capability.unknown') ? 'warning' : 'positive' },
    { label: t('settings.providers.capability.reasoning'), value: formatReasoningCapability(model, t), tone: model?.reasoning.kind === 'none' ? 'negative' : model ? 'positive' : 'warning' },
    { label: t('settings.providers.capability.fastMode'), value: fast, tone: fastTone },
    { label: t('settings.providers.capability.toolCalling'), value: formatCapabilityState(model?.toolCalling, t), tone: stateTone(model?.toolCalling) },
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
