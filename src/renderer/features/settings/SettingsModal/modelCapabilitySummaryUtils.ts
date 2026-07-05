import {
  lookupManagedModelCatalogEntry,
  type ManagedModelCatalogEntry,
} from '@shared/constants/modelCapabilityCatalog';
import type { ModelCapabilityProfile, ReasoningLevel } from '@shared/types/modelCapability';
import type { LlmProviderCatalogOwnership } from '@shared/types/settings';
import type { useI18n } from '../../../i18n';
import { formatTokenCount } from '../../debugger/composer/turnControlsUtils';

type Translate = ReturnType<typeof useI18n>['t'];

const REASONING_LABEL_KEYS = {
  off: 'composer.effort.levelOff',
  auto: 'composer.effort.levelAuto',
  low: 'composer.effort.levelLow',
  medium: 'composer.effort.levelMedium',
  high: 'composer.effort.levelHigh',
  extHigh: 'composer.effort.levelExtHigh',
  max: 'composer.effort.levelMax',
} as const satisfies Record<ReasoningLevel, Parameters<Translate>[0]>;

export interface CapabilityChip {
  label: string;
  value: string;
  tone?: 'default' | 'muted' | 'positive';
}

export function getReasoningLabelKey(level: ReasoningLevel): typeof REASONING_LABEL_KEYS[ReasoningLevel] {
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
  const levels = profile?.supportedReasoningLevels ?? [];
  return levels.length > 0
    ? levels.map((level) => t(REASONING_LABEL_KEYS[level])).join(', ')
    : t('settings.providers.capability.notAvailable');
}

export function formatFastCapability(
  profile: ModelCapabilityProfile | null,
  t: Translate,
): string {
  return profile?.fastVariantModelId || t('settings.providers.capability.notAvailable');
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
      tone: profile?.supportedReasoningLevels?.some((level) => level !== 'off') ? 'positive' : 'muted',
    },
    {
      label: t('settings.providers.capability.fastMode'),
      value: formatFastCapability(profile, t),
      tone: profile?.fastVariantModelId ? 'positive' : 'muted',
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
