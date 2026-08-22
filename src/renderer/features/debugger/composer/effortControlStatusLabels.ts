import type { EffectiveModel } from '@shared/types/providerCapability';
import {
  isFastModeDenied,
  isMaxContextDenied,
} from './turnControlsUtils';

export function buildEffortCapabilityStatusLabels(input: {
  capability: EffectiveModel | null;
  capabilityReady: boolean;
  capabilityStateLabel: string | undefined;
  maxTierUnverified: boolean;
  fastUnverified: boolean;
  t: (key:
    | 'composer.effort.fixed'
    | 'composer.effort.unverified'
    | 'composer.effort.unsupported'
    | 'composer.effort.currentAccountUnavailable') => string;
}): {
  maxContextStatusLabel: string | undefined;
  fastModelStatusLabel: string | undefined;
} {
  const { capability, capabilityReady, capabilityStateLabel, t } = input;
  const maxContextCapability = capability?.resolvedControls?.maxContext
    ?? capability?.controls.maxContext
    ?? null;
  const fastCapability = capability?.resolvedControls?.fast
    ?? capability?.controls.fast
    ?? null;

  const maxContextStatusLabel = !capabilityReady
    ? capabilityStateLabel
    : maxContextCapability?.state === 'fixed'
      ? t('composer.effort.fixed')
      : maxContextCapability?.state === 'unsupported'
        ? t('composer.effort.unsupported')
        : input.maxTierUnverified
          ? t('composer.effort.unverified')
          : isMaxContextDenied(capability)
            ? t('composer.effort.currentAccountUnavailable')
            : undefined;

  const fastModelStatusLabel = !capabilityReady
    ? capabilityStateLabel
    : fastCapability?.state === 'fixed'
      ? t('composer.effort.fixed')
      : fastCapability?.state === 'unsupported'
        ? t('composer.effort.unsupported')
        : input.fastUnverified
          ? t('composer.effort.unverified')
          : isFastModeDenied(capability)
            ? t('composer.effort.currentAccountUnavailable')
            : undefined;

  return { maxContextStatusLabel, fastModelStatusLabel };
}
