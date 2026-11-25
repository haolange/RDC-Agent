import React, { useState } from 'react';
import { resolveContextTierChoices } from '@shared/utils/contextTiers';
import { buildCapabilityChips } from '../modelCapabilitySummaryUtils';
import { errorDetail } from '../../../../lib/errorDetail';
import { InlineError } from '../../../../ui/InlineError';
import { Skeleton } from '../../../../ui/Skeleton';
import { useI18n } from '../../../../i18n';
import { testModelCapability } from './providerCatalogActions';
import { ProviderModelProbe } from './ProviderModelProbe';
import { ProviderModelPreferences } from './ProviderModelPreferences';
import { ProviderModelDetails } from './ProviderModelDetails';
import { providerProbeResultText } from './providerProbeResultText';
import type {
  LlmModelCapabilityProbeMode,
  LlmModelCapabilityProbeResult,
  LlmProviderEntry,
  LlmProviderModel,
} from '@shared/types/settings';
import type { EffectiveCatalogSnapshot, EffectiveModel } from '@shared/types/providerCapability';

export interface ProviderModelCapabilitySummaryProps {
  provider: Pick<LlmProviderEntry, 'id' | 'catalogOwnership' | 'activeAccountId' | 'protocol' | 'isConfigured' | 'serviceOperator' | 'authMode'>;
  model: LlmProviderModel;
  effectiveModel: EffectiveModel | null;
  snapshot: EffectiveCatalogSnapshot | null;
  loading: boolean;
  loadFailed: boolean;
  onModelChange: (patch: Partial<LlmProviderModel>) => void;
}

export const ProviderModelCapabilitySummary: React.FC<ProviderModelCapabilitySummaryProps> = ({
  provider,
  model,
  effectiveModel,
  snapshot,
  loading,
  loadFailed,
  onModelChange,
}) => {
  const { t } = useI18n();
  const [probeMode, setProbeMode] = useState<LlmModelCapabilityProbeMode | null>(null);
  const [probeResult, setProbeResult] = useState<LlmModelCapabilityProbeResult | null>(null);
  const chips = buildCapabilityChips(effectiveModel, t);
  const contextChoices = effectiveModel ? resolveContextTierChoices(effectiveModel) : null;
  const probeModes: LlmModelCapabilityProbeMode[] = effectiveModel ? [
    'default',
    ...(contextChoices?.maxTier ? ['max-context' as const] : []),
    ...(effectiveModel.controls.fast.state === 'selectable' ? ['fast' as const] : []),
    ...(effectiveModel.executionBindings?.some(binding => binding.when.fast === true && binding.when.maxContext === true)
      ? ['fast-max-context' as const] : []),
  ] : [];
  const runProbe = async (mode: LlmModelCapabilityProbeMode) => {
    setProbeMode(mode);
    setProbeResult(null);
    try {
      const result = await testModelCapability({
        providerId: provider.id,
        modelId: model.id,
        mode,
      });
      if (!result) {
        setProbeResult({
          success: false,
          status: 'failed',
          requestSent: false,
          detail: 'Capability probe is unavailable.',
        });
        return;
      }
      setProbeResult(result);
    } catch (error) {
      setProbeResult({
        success: false,
        status: 'failed',
        requestSent: false,
        detail: errorDetail(error),
      });
    } finally {
      setProbeMode(null);
    }
  };
  const probeText = probeResult ? providerProbeResultText(probeResult, t) : null;

  return (
    <div className="settings-model-capability-panel" data-testid={`settings-provider-model-capability-panel-${model.id}`}>
      {loading ? (
        <div role="status" aria-label={t('settings.providers.capability.loading')}><Skeleton shape="line" count={2} /></div>
      ) : loadFailed ? (
        <div className="settings-model-capability-note settings-model-capability-note--error">{t('settings.providers.capability.loadFailed')}</div>
      ) : effectiveModel ? (
        <>
          <dl className="settings-model-capability-grid">
            {chips.map((chip) => (
              <div key={chip.label} data-tone={chip.tone ?? 'default'}>
                <dt>{chip.label}</dt>
                <dd>{chip.value}</dd>
              </div>
            ))}
          </dl>
          {effectiveModel.toolCalling.state === 'unknown' ? (
            <div className="settings-model-capability-note" data-testid="settings-provider-tool-calling-unverified">{t('settings.providers.capability.toolCallingUnverifiedHint')}</div>
          ) : effectiveModel.toolCalling.state === 'unsupported' ? (
            <div className="settings-model-capability-note" data-testid="settings-provider-tool-calling-unsupported">{t('settings.providers.capability.toolCallingUnsupportedHint')}</div>
          ) : null}

          <ProviderModelPreferences {...{ model, effectiveModel, snapshot, loading, onModelChange, t }} />
          <ProviderModelDetails {...{ model, effectiveModel, t }} />
          <ProviderModelProbe {...{ model, provider, t, probeMode, probeModes, runProbe }} />
          {probeResult && probeText ? (
            <div
              className={`settings-model-capability-probe-result settings-model-capability-probe-result--${probeResult.status}`}
              role="status"
            >
              <strong>{probeText.status}</strong>
              {probeText.detail ? <span>{probeText.detail}</span> : null}
            </div>
          ) : null}
          {snapshot?.refreshing ? <div className="settings-model-capability-note">{t('settings.providers.capability.refreshing')}</div> : null}
          {snapshot?.stale ? <div className="settings-model-capability-note">{t('settings.providers.capability.stale')}</div> : null}
          {effectiveModel.quota ? (
            <div className="settings-model-capability-note settings-model-capability-note--warning">
              {t('settings.providers.capability.quota', {
                time: effectiveModel.quota.exhaustedUntil ?? t('settings.providers.capability.unknown'),
                note: effectiveModel.quota.note ?? '',
              })}
            </div>
          ) : null}
          {effectiveModel.unavailableReason ? (
            <InlineError detail={effectiveModel.unavailableReason}>{t('settings.providers.modelUnavailableReason')}</InlineError>
          ) : null}
        </>
      ) : (
        <div className="settings-model-capability-note">
          {provider.catalogOwnership === 'user-managed' ? t('settings.providers.capability.userManagedDetail') : t('settings.providers.capability.modelMissing')}
        </div>
      )}
    </div>
  );
};
