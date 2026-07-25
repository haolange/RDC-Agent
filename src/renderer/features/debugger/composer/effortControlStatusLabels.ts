import type { EffectiveModel } from '@shared/types/providerCapability';
import {
  isFastModeDenied,
  isOneMillionContextDenied,
} from './turnControlsUtils';

export function buildEffortCapabilityStatusLabels(input: {
  capability: EffectiveModel | null;
  capabilityReady: boolean;
  capabilityStateLabel: string | undefined;
  oneMillionUnverified: boolean;
  fastUnverified: boolean;
  t: (key: 'composer.effort.fixed' | 'composer.effort.unverified' | 'composer.effort.currentAccountUnavailable') => string;
}): {
  oneMillionContextStatusLabel: string | undefined;
  fastModelStatusLabel: string | undefined;
} {
  const { capability, capabilityReady, capabilityStateLabel, t } = input;
  const oneMillionCapability = capability?.resolvedControls?.context1m ?? null;

  const oneMillionContextStatusLabel = !capabilityReady
    ? capabilityStateLabel
    : oneMillionCapability?.state === 'fixed'
      ? t('composer.effort.fixed')
      : input.oneMillionUnverified
        ? t('composer.effort.unverified')
        : isOneMillionContextDenied(capability)
          ? t('composer.effort.currentAccountUnavailable')
          : undefined;

  const fastModelStatusLabel = !capabilityReady
    ? capabilityStateLabel
    : capability?.resolvedControls?.fast.state === 'fixed'
      ? t('composer.effort.fixed')
      : input.fastUnverified
        ? t('composer.effort.unverified')
        : isFastModeDenied(capability)
          ? t('composer.effort.currentAccountUnavailable')
          : undefined;

  return { oneMillionContextStatusLabel, fastModelStatusLabel };
}
