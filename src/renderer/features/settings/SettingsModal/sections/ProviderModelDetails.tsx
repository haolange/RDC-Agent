import { buildContextTierRows, buildPricingRows, buildCapabilityEvidenceSummary } from '../modelCapabilitySummaryUtils';
import { buildRouteOptionMeta } from '../utils';
import type { ProviderModelCapabilitySummaryProps } from './ProviderModelCapabilitySummary';

export function ProviderModelDetails({ model, effectiveModel, provider, t }: Pick<ProviderModelCapabilitySummaryProps, 'model' | 'effectiveModel' | 'provider' | 't'>) {
  if (!effectiveModel) return null;
  const tiers = buildContextTierRows(effectiveModel, t);
  const pricing = buildPricingRows(effectiveModel, t);
  return <div className="settings-model-details-body">
    <div className="settings-model-capability-tiers" data-testid={`settings-provider-model-tiers-${model.id}`}>
      <span className="settings-model-capability-section-label">{t('settings.providers.capability.contextTiers')}</span>
      {tiers.map((tier) => (
        <div key={tier.id} className="settings-model-capability-tier" data-tone={tier.tone ?? 'default'}>
          <span className="settings-model-capability-tier-main">
            <strong>{tier.label}</strong>
            <span>{tier.limit}</span>
          </span>
          <span className="settings-model-capability-tier-meta">
            {[tier.entitlement, tier.activation, tier.cost].filter(Boolean).join(' · ')}
          </span>
        </div>
      ))}
    </div>

    {pricing.length > 0 ? (
      <div className="settings-model-capability-tiers" data-testid={`settings-provider-model-pricing-${model.id}`}>
        <span className="settings-model-capability-section-label">{t('settings.providers.capability.pricing')}</span>
        {pricing.map((row) => (
          <div key={row.id} className="settings-model-capability-tier" data-tone="default">
            <span className="settings-model-capability-tier-main"><strong>{row.label}</strong></span>
            <span className="settings-model-capability-tier-meta">{row.value}</span>
          </div>
        ))}
      </div>
    ) : null}


    {(effectiveModel.routeOptions ?? []).map((option) => <div className="settings-model-capability-note" key={option.id}>
      {option.label} · {buildRouteOptionMeta(option, provider.serviceOperator, (owner) => t('settings.providers.capability.protocolOwner', { owner }))}
    </div>)}
    <div className="settings-model-capability-source">{buildCapabilityEvidenceSummary(effectiveModel, t)}</div>
  </div>;
}
