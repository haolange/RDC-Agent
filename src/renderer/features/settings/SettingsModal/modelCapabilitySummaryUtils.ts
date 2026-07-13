import {
  lookupManagedModelCatalogEntry,
  type ManagedModelCatalogEntry,
} from '@shared/constants/modelCapabilityCatalog';
import type { ModelCapabilityProfile, ReasoningSelection } from '@shared/types/modelCapability';
import type { LlmProviderCatalogOwnership } from '@shared/types/settings';
import type { useI18n } from '../../../i18n';
import { buildDisplaySelections } from '../../debugger/composer/effortControlParts';
import { formatTokenCount } from '../../debugger/composer/turnControlsUtils';

type Translate = ReturnType<typeof useI18n>['t'];

const REASONING_LABEL_KEYS = {
  off: 'composer.effort.levelOff',
  on: 'composer.effort.levelOn',
  minimal: 'composer.effort.levelMinimal',
  low: 'composer.effort.levelLow',
  medium: 'composer.effort.levelMedium',
  high: 'composer.effort.levelHigh',
  extra: 'composer.effort.levelExtra',
  max: 'composer.effort.levelMax',
  ultra: 'composer.effort.levelUltra',
} as const satisfies Record<ReasoningSelection, Parameters<Translate>[0]>;

export interface CapabilityChip {
  label: string;
  value: string;
  tone?: 'default' | 'muted' | 'positive';
}

export function getReasoningLabelKey(level: ReasoningSelection): typeof REASONING_LABEL_KEYS[ReasoningSelection] {
  return REASONING_LABEL_KEYS[level];
}

export function findManagedCapabilityEntry(
  providerId: string,
  catalogOwnership: LlmProviderCatalogOwnership,
  modelId: string,
): ManagedModelCatalogEntry | null {
  if (catalogOwnership !== 'app-managed') {
    return null;
  }
  return lookupManagedModelCatalogEntry(providerId, modelId);
}

export function formatContextCapability(
  profile: ModelCapabilityProfile | null,
  t: Translate,
): string {
  return profile?.nominalContextWindowTokens
    ? formatTokenCount(profile.nominalContextWindowTokens)
    : t('settings.providers.capability.unknown');
}

export function formatReasoningCapability(
  profile: ModelCapabilityProfile | null,
  t: Translate,
): string {
  const control = profile?.reasoningControl ?? null;
  if (!control) {
    return t('settings.providers.capability.notAvailable');
  }
  const levels = buildDisplaySelections(control);
  if (levels.length === 0 || (levels.length === 1 && levels[0] === 'off' && control?.kind === 'none')) {
    return t('settings.providers.capability.notAvailable');
  }
  const base = levels.map((level) => t(REASONING_LABEL_KEYS[level])).join(', ');
  return control?.kind === 'always-on'
    ? t('settings.providers.capability.lockedValue', { value: base })
    : base;
}

export function formatFastCapability(
  profile: ModelCapabilityProfile | null,
  t: Translate,
): string {
  return profile?.fast?.modelId || t('settings.providers.capability.notAvailable');
}

export function formatBooleanCapability(value: boolean | undefined, t: Translate): string {
  return value ? t('settings.providers.capability.supported') : t('settings.providers.capability.notAvailable');
}

export function buildCapabilityChips(
  entry: ManagedModelCatalogEntry | null,
  t: Translate,
): CapabilityChip[] {
  const profile = entry?.profile ?? null;
  return [
    {
      label: t('settings.providers.capability.context'),
      value: formatContextCapability(profile, t),
      tone: profile?.nominalContextWindowTokens ? 'positive' : 'muted',
    },
    {
      label: t('settings.providers.capability.reasoning'),
      value: formatReasoningCapability(profile, t),
      tone: profile?.reasoningControl && profile.reasoningControl.kind !== 'none' ? 'positive' : 'muted',
    },
    {
      label: t('settings.providers.capability.fastMode'),
      value: formatFastCapability(profile, t),
      tone: profile?.fast?.modelId ? 'positive' : 'muted',
    },
    {
      label: t('settings.providers.capability.toolCalling'),
      value: formatBooleanCapability(profile?.toolCalling, t),
      tone: profile?.toolCalling ? 'positive' : 'muted',
    },
    {
      label: t('settings.providers.capability.visionInput'),
      value: formatBooleanCapability(profile?.visionInput, t),
      tone: profile?.visionInput ? 'positive' : 'muted',
    },
    {
      label: t('settings.providers.capability.structuredOutput'),
      value: formatBooleanCapability(profile?.structuredOutput, t),
      tone: profile?.structuredOutput ? 'positive' : 'muted',
    },
  ];
}
