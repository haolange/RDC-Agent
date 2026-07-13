import type { EffectiveCatalogSnapshot, EffectiveModel } from '@shared/types/providerCapability';
import type { ReasoningControl, ReasoningSelection } from '@shared/types/modelCapability';
import type { useI18n } from '../../../i18n';
import { buildDisplaySelections } from '../../debugger/composer/effortControlParts';
import { formatTokenCount } from '../../debugger/composer/turnControlsUtils';

type Translate = ReturnType<typeof useI18n>['t'];

const REASONING_LABEL_KEYS = {
  off: 'composer.effort.levelOff', on: 'composer.effort.levelOn', minimal: 'composer.effort.levelMinimal',
  low: 'composer.effort.levelLow', medium: 'composer.effort.levelMedium', high: 'composer.effort.levelHigh',
  extra: 'composer.effort.levelExtra', max: 'composer.effort.levelMax', ultra: 'composer.effort.levelUltra',
} as const satisfies Record<ReasoningSelection, Parameters<Translate>[0]>;

export interface CapabilityChip {
  label: string;
  value: string;
  tone?: 'default' | 'muted' | 'positive';
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

export function formatContextCapability(model: EffectiveModel | null, t: Translate): string {
  const maximum = Math.max(0, ...model?.contextTiers.map((tier) => (
    tier.maxPromptTokens ?? tier.maxTotalTokens ?? 0
  )) ?? []);
  return maximum > 0 ? formatTokenCount(maximum) : t('settings.providers.capability.unknown');
}

export function formatReasoningCapabilityValue(control: ReasoningControl | null, t: Translate): string {
  if (!control) return t('settings.providers.capability.notAvailable');
  const levels = buildDisplaySelections(control);
  if (levels.length === 0 || (levels.length === 1 && levels[0] === 'off' && control.kind === 'none')) {
    return t('settings.providers.capability.notAvailable');
  }
  const base = levels.map((level) => t(REASONING_LABEL_KEYS[level])).join(', ');
  return control.kind === 'always-on' ? t('settings.providers.capability.lockedValue', { value: base }) : base;
}

export function formatReasoningCapability(model: EffectiveModel | null, t: Translate): string {
  return formatReasoningCapabilityValue(model?.reasoning ?? null, t);
}

export function formatFastCapability(model: EffectiveModel | null, t: Translate): string {
  if (!model || model.fast.kind === 'unsupported' || model.fast.kind === 'unknown') {
    return t('settings.providers.capability.notAvailable');
  }
  if (model.fast.kind === 'model-variant') return model.fast.modelId;
  return model.fast.label ?? model.fast.kind;
}

export function formatCapabilityState(model: EffectiveModel | null, field: 'toolCalling' | 'visionInput' | 'structuredOutput', t: Translate): string {
  return model?.[field].state === 'supported'
    ? t('settings.providers.capability.supported')
    : t('settings.providers.capability.notAvailable');
}

export function buildCapabilityChips(model: EffectiveModel | null, t: Translate): CapabilityChip[] {
  const context = formatContextCapability(model, t);
  const reasoning = formatReasoningCapability(model, t);
  const fast = formatFastCapability(model, t);
  return [
    { label: t('settings.providers.capability.context'), value: context, tone: context !== t('settings.providers.capability.unknown') ? 'positive' : 'muted' },
    { label: t('settings.providers.capability.reasoning'), value: reasoning, tone: model?.reasoning.kind !== 'none' ? 'positive' : 'muted' },
    { label: t('settings.providers.capability.fastMode'), value: fast, tone: model && model.fast.kind !== 'unknown' && model.fast.kind !== 'unsupported' ? 'positive' : 'muted' },
    { label: t('settings.providers.capability.toolCalling'), value: formatCapabilityState(model, 'toolCalling', t), tone: model?.toolCalling.state === 'supported' ? 'positive' : 'muted' },
    { label: t('settings.providers.capability.visionInput'), value: formatCapabilityState(model, 'visionInput', t), tone: model?.visionInput.state === 'supported' ? 'positive' : 'muted' },
    { label: t('settings.providers.capability.structuredOutput'), value: formatCapabilityState(model, 'structuredOutput', t), tone: model?.structuredOutput.state === 'supported' ? 'positive' : 'muted' },
  ];
}
