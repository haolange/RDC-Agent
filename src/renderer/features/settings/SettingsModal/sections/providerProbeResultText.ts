import type { LlmModelCapabilityProbeResult } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';

/** The probe outcome in words: verified, failed or inconclusive, with the known reason when there is one. */
export function providerProbeResultText(result: LlmModelCapabilityProbeResult, t: ReturnType<typeof useI18n>['t']) {
  const fastVerified =
    result.status === 'verified' &&
    result.evidence?.requestedServiceTier === 'priority' &&
    result.evidence.serviceTier === 'priority';
  return {
    status: fastVerified
      ? t('settings.providers.capability.fastTier.verified')
      : t(`settings.providers.capability.probeStatus.${result.status}`),
    detail: result.detailCode ? t(`settings.providers.capability.fastTier.${result.detailCode}`) : undefined,
  };
}
