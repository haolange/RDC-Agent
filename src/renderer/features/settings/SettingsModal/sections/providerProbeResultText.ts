import type { LlmModelCapabilityProbeResult } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';

export function providerProbeResultText(
  result: LlmModelCapabilityProbeResult,
  t: ReturnType<typeof useI18n>['t'],
) {
  const requested = result.evidence?.requestedServiceTier;
  const actual = result.evidence?.serviceTier;
  const fastVerified = result.status === 'verified' && requested === 'priority' && actual === 'priority';
  return {
    status: fastVerified
      ? t('settings.providers.capability.fastTier.verified')
      : t(`settings.providers.capability.probeStatus.${result.status}`),
    detail: result.detailCode ? t(`settings.providers.capability.fastTier.${result.detailCode}`) : result.detail,
    tiers: requested ? t('settings.providers.capability.fastTier.receipt', {
      requested,
      actual: actual ?? t('settings.providers.capability.fastTier.unreported'),
    }) : undefined,
  };
}
