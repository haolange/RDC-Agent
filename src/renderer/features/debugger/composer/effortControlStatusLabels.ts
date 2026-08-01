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
  t: (key:
    | 'composer.effort.fixed'
    | 'composer.effort.levelOff'
    | 'composer.effort.unsupported'
    | 'composer.effort.currentAccountUnavailable') => string;
}): {
  oneMillionContextStatusLabel: string | undefined;
  fastModelStatusLabel: string | undefined;
} {
  const { capability, capabilityReady, capabilityStateLabel, t } = input;
  const oneMillionCapability = capability?.resolvedControls?.context1m
    ?? capability?.controls.context1m
    ?? null;
  const fastCapability = capability?.resolvedControls?.fast
    ?? capability?.controls.fast
    ?? null;

  const oneMillionContextStatusLabel = !capabilityReady
    ? capabilityStateLabel
    : oneMillionCapability?.state === 'fixed'
      ? t('composer.effort.fixed')
      : oneMillionCapability?.state === 'unsupported'
        ? t('composer.effort.unsupported')
        : input.oneMillionUnverified
          ? t('composer.effort.levelOff')
          : isOneMillionContextDenied(capability)
            ? t('composer.effort.currentAccountUnavailable')
            : undefined;

  const fastModelStatusLabel = !capabilityReady
    ? capabilityStateLabel
    : fastCapability?.state === 'fixed'
      ? t('composer.effort.fixed')
      : fastCapability?.state === 'unsupported'
        ? t('composer.effort.unsupported')
        : input.fastUnverified
          ? t('composer.effort.levelOff')
          : isFastModeDenied(capability)
            ? t('composer.effort.currentAccountUnavailable')
            : undefined;

  return { oneMillionContextStatusLabel, fastModelStatusLabel };
}
