import React, { useState } from 'react';
import type { EffectiveCatalogSnapshot, EffectiveModel } from '@shared/types/providerCapability';
import type {
  LlmModelCapabilityProbeMode,
  LlmModelCapabilityProbeResult,
  LlmProviderEntry,
  LlmProviderModel,
} from '@shared/types/settings';
import { resolveContextTierChoices } from '@shared/utils/contextTiers';
import type { useI18n } from '../../../../i18n';
import { testModelCapability } from './providerCatalogActions';
import { buildCapabilityChips } from '../modelCapabilitySummaryUtils';
import { ProviderModelProbe } from './ProviderModelProbe';
import { ProviderModelPreferences } from './ProviderModelPreferences';
import { ProviderModelDetails } from './ProviderModelDetails';

type Translate = ReturnType<typeof useI18n>['t'];

export interface ProviderModelCapabilitySummaryProps {
  provider: Pick<LlmProviderEntry, 'id' | 'catalogOwnership' | 'activeAccountId' | 'protocol' | 'isConfigured' | 'serviceOperator' | 'authMode'>;
  model: LlmProviderModel;
  effectiveModel: EffectiveModel | null;
  snapshot: EffectiveCatalogSnapshot | null;
  loading: boolean;
  loadFailed: boolean;
  onModelChange: (patch: Partial<LlmProviderModel>) => void;
  t: Translate;
}

export const ProviderModelCapabilitySummary: React.FC<ProviderModelCapabilitySummaryProps> = ({
  provider,
  model,
  effectiveModel,
  snapshot,
  loading,
  loadFailed,
  onModelChange,
  t,
}) => {
  const [probeMode, setProbeMode] = useState<LlmModelCapabilityProbeMode | null>(null);
  const [probeResult, setProbeResult] = useState<LlmModelCapabilityProbeResult | null>(null);
  const chips = buildCapabilityChips(effectiveModel, t).filter((chip) => chip.label !== t('settings.providers.capability.route'));
  const contextChoices = effectiveModel ? resolveContextTierChoices(effectiveModel) : null;
  const probeModes: LlmModelCapabilityProbeMode[] = effectiveModel ? [
    'default',
    ...(contextChoices?.maxTier ? ['max-context' as const] : []),
    ...(effectiveModel.controls.fast.state === 'selectable' ? ['fast' as const] : []),
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
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setProbeMode(null);
    }
  };
  const probeStatus = probeResult ? t(`settings.providers.capability.probeStatus.${probeResult.status}`) : '';

  return (
    <div className="settings-model-capability-panel" data-testid={`settings-provider-model-capability-panel-${model.id}`}>
      {loading ? (
        <div className="settings-model-capability-note">{t('settings.providers.capability.loading')}</div>
      ) : loadFailed ? (
        <div className="settings-model-capability-note settings-model-capability-note--error">{t('settings.providers.capability.loadFailed')}</div>
      ) : effectiveModel ? (
        <>
          <div className="settings-model-capability-grid">
            {chips.map((chip) => (
              <div key={chip.label} className="settings-model-capability-chip" data-tone={chip.tone ?? 'default'}>
                <span className="settings-model-capability-chip-label">{chip.label}</span>
                <span className="settings-model-capability-chip-value">{chip.value}</span>
              </div>
            ))}
          </div>
          {effectiveModel.toolCalling.state === 'unknown' ? (
            <div className="settings-model-capability-note" data-testid="settings-provider-tool-calling-unverified">{t('settings.providers.capability.toolCallingUnverifiedHint')}</div>
          ) : effectiveModel.toolCalling.state === 'unsupported' ? (
            <div className="settings-model-capability-note" data-testid="settings-provider-tool-calling-unsupported">{t('settings.providers.capability.toolCallingUnsupportedHint')}</div>
          ) : null}

          <ProviderModelPreferences {...{ model, effectiveModel, snapshot, loading, onModelChange, t }} />
          <details className="settings-model-details">
            <summary>{t('settings.providers.capability.details')}</summary>
            <ProviderModelDetails {...{ model, effectiveModel, provider, t }} />
            <ProviderModelProbe {...{ model, provider, t, probeMode, probeModes, runProbe }} />
          </details>
          {probeResult ? (
            <div
              className={`settings-model-capability-probe-result settings-model-capability-probe-result--${probeResult.status}`}
              role="status"
            >
              <strong>{probeStatus}</strong>
              {probeResult.detail ? <span>{probeResult.detail}</span> : null}
            </div>
          ) : null}
          {snapshot?.refreshing ? <div className="settings-model-capability-note">{t('settings.providers.capability.refreshing')}</div> : null}
          {snapshot?.stale ? <div className="settings-model-capability-note">{t('settings.providers.capability.stale')}</div> : null}
          {snapshot?.lastRefreshError ? (
            <div className="settings-model-capability-note settings-model-capability-note--warning">{t('settings.providers.capability.refreshFailed', { error: snapshot.lastRefreshError })}</div>
          ) : null}
          {effectiveModel.quota ? (
            <div className="settings-model-capability-note settings-model-capability-note--warning">
              {t('settings.providers.capability.quota', {
                time: effectiveModel.quota.exhaustedUntil ?? t('settings.providers.capability.unknown'),
                note: effectiveModel.quota.note ?? '',
              })}
            </div>
          ) : null}
          {effectiveModel.unavailableReason ? <div className="settings-model-capability-note settings-model-capability-note--error">{effectiveModel.unavailableReason}</div> : null}
        </>
      ) : (
        <div className="settings-model-capability-note">
          {provider.catalogOwnership === 'user-managed' ? t('settings.providers.capability.userManagedDetail') : t('settings.providers.capability.modelMissing')}
        </div>
      )}
    </div>
  );
};
