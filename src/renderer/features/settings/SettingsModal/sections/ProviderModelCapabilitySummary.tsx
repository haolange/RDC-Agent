import React, { useState } from 'react';
import type { EffectiveCatalogSnapshot, EffectiveModel } from '@shared/types/providerCapability';
import { getReasoningSelectionOrder, type ReasoningSelection } from '@shared/types/modelCapability';
import type {
  LlmModelCapabilityProbeMode,
  LlmModelCapabilityProbeResult,
  LlmProviderEntry,
  LlmProviderModel,
} from '@shared/types/settings';
import { resolveContextTierChoices } from '@shared/utils/contextTiers';
import type { useI18n } from '../../../../i18n';
import { getElectronApi } from '../../../../platform/getElectronApi';
import {
  buildCapabilityChips,
  buildCapabilityEvidenceSummary,
  buildContextTierRows,
  buildPricingRows,
  getReasoningLabelKey,
} from '../modelCapabilitySummaryUtils';
import { getProviderProtocolLabel, buildRouteOptionMeta } from '../utils';

type Translate = ReturnType<typeof useI18n>['t'];

interface ProviderModelCapabilitySummaryProps {
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
  const chips = buildCapabilityChips(effectiveModel, t);
  const tiers = buildContextTierRows(effectiveModel, t);
  const pricing = buildPricingRows(effectiveModel, t);
  const reasoningUnverified = effectiveModel?.controls.reasoning.kind === 'unknown';
  const reasoningDefaultUnverified = reasoningUnverified
    || effectiveModel?.controls.reasoning.defaultState === 'unknown'
    || effectiveModel?.controls.reasoning.defaultState === 'provider-managed';
  const reasoningOptions = reasoningUnverified ? [] : getReasoningSelectionOrder(effectiveModel?.controls.reasoning);
  const defaultReasoning = effectiveModel?.controls.reasoning.defaultSelection ?? 'off';
  const routeOptions = effectiveModel?.routeOptions ?? [];
  const effectiveRouteOption = routeOptions.find((option) => option.routeRevision === effectiveModel?.routeRevision)
    ?? routeOptions.find((option) => option.route.protocol === effectiveModel?.route.protocol);
  const selectedRouteOptionId = model.preferredRouteOptionId
    ?? effectiveModel?.preferredRouteOptionId
    ?? effectiveRouteOption?.id
    ?? routeOptions[0]?.id
    ?? '';
  const routeOptionMeta = (option: NonNullable<EffectiveModel['routeOptions']>[number]): string => (
    buildRouteOptionMeta(
      option,
      provider.serviceOperator,
      (owner) => t('settings.providers.capability.protocolOwner', { owner }),
    )
  );
  const contextChoices = effectiveModel ? resolveContextTierChoices(effectiveModel) : null;
  const probeModes: LlmModelCapabilityProbeMode[] = effectiveModel ? [
    'default',
    ...(contextChoices?.maxTier ? ['max-context' as const] : []),
    ...(effectiveModel.controls.fast.state === 'selectable' ? ['fast' as const] : []),
  ] : [];
  const updateBudget = (raw: string) => {
    if (!raw.trim()) {
      onModelChange({ defaultBudgetTokens: undefined });
      return;
    }
    const parsed = Number(raw);
    onModelChange({
      defaultBudgetTokens: Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined,
    });
  };
  const runProbe = async (mode: LlmModelCapabilityProbeMode) => {
    setProbeMode(mode);
    setProbeResult(null);
    try {
      const result = await getElectronApi()!.llm.testModelCapability({
        providerId: provider.id,
        modelId: model.id,
        mode,
      });
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
  const probeStatus = probeResult
    ? t(`settings.providers.capability.probeStatus.${probeResult.status}`)
    : '';

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
          ) : null}

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

          <div className="settings-model-preferences" data-testid={`settings-provider-model-preferences-${model.id}`}>
            <div className="settings-model-preferences-heading">
              <span className="settings-model-capability-section-label">{t('settings.providers.capability.preferences')}</span>
              <span className="settings-help-text">{t('settings.providers.capability.preferencesHint')}</span>
            </div>
            <div className="settings-model-preferences-grid">
              <label className="settings-field">
                <span className="settings-field-label">{t('settings.providers.capability.route')}</span>
                {routeOptions.length > 1 ? (
                  <select
                    className="input"
                    value={selectedRouteOptionId}
                    disabled={loading || snapshot?.refreshing}
                    onChange={(event) => onModelChange({ preferredRouteOptionId: event.target.value || undefined })}
                  >
                    {routeOptions.map((option) => (
                      <option
                        key={option.id}
                        value={option.id}
                        disabled={option.availability !== 'available'}
                      >
                        {option.label ?? getProviderProtocolLabel(option.route.protocol)} · {routeOptionMeta(option)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="settings-model-route-readonly">
                    {routeOptions[0]?.label ?? getProviderProtocolLabel(effectiveModel.route.protocol)}
                    {' · '}{routeOptions[0] ? routeOptionMeta(routeOptions[0]) : provider.serviceOperator}
                  </span>
                )}
                <span className="settings-help-text">
                  {routeOptions.length > 1
                    ? t('settings.providers.capability.routeHint')
                    : t('settings.providers.capability.routeReadonlyHint')}
                </span>
              </label>
              <label className="settings-field">
                <span className="settings-field-label">{t('settings.providers.capability.defaultReasoning')}</span>
                <select
                  className="input"
                  value={reasoningDefaultUnverified ? '' : model.defaultReasoningSelection ?? ''}
                  disabled={reasoningOptions.length <= 1}
                  onChange={(event) => onModelChange({
                    defaultReasoningSelection: event.target.value
                      ? event.target.value as ReasoningSelection
                      : undefined,
                  })}
                >
                  <option value="">
                    {reasoningDefaultUnverified
                      ? t('composer.effort.levelOff')
                      : t('settings.providers.capability.providerDefault', { value: t(getReasoningLabelKey(defaultReasoning)) })}
                  </option>
                  {reasoningOptions.map((selection) => (
                    <option key={selection} value={selection}>{t(getReasoningLabelKey(selection))}</option>
                  ))}
                </select>
              </label>
              <label className="settings-field">
                <span className="settings-field-label">{t('settings.providers.capability.clientBudget')}</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  step={1000}
                  value={model.defaultBudgetTokens ?? ''}
                  placeholder={String(effectiveModel.defaultBudgetTokens)}
                  onChange={(event) => updateBudget(event.target.value)}
                />
                <span className="settings-help-text">
                  {t('settings.providers.capability.clientBudgetHint', { value: effectiveModel.defaultBudgetTokens })}
                </span>
              </label>
            </div>
          </div>

          <div className="settings-model-capability-probe" data-testid={`settings-provider-model-probe-${model.id}`}>
            <div className="settings-model-preferences-heading">
              <span className="settings-model-capability-section-label">{t('settings.providers.capability.probe')}</span>
              <span className="settings-help-text">{t('settings.providers.capability.probeHint')}</span>
            </div>
            <div className="settings-model-capability-probe-actions">
              {probeModes.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className="button button-secondary button-sm"
                  disabled={!provider.isConfigured || !model.enabled || probeMode !== null}
                  onClick={() => void runProbe(mode)}
                >
                  {probeMode === mode
                    ? t('settings.providers.capability.probing')
                    : t(`settings.providers.capability.probeMode.${mode}`)}
                </button>
              ))}
            </div>
            {!provider.isConfigured ? (
              <span className="settings-help-text">{t('settings.providers.capability.probeRequiresConnection')}</span>
            ) : null}
            {probeResult ? (
              <div
                className={`settings-model-capability-probe-result settings-model-capability-probe-result--${probeResult.status}`}
                role="status"
              >
                <strong>{probeStatus}</strong>
                {probeResult.detail ? <span>{probeResult.detail}</span> : null}
              </div>
            ) : null}
          </div>

          <div className="settings-model-capability-source">{buildCapabilityEvidenceSummary(effectiveModel, t)}</div>
          {snapshot?.refreshing ? <div className="settings-model-capability-note">{t('settings.providers.capability.refreshing')}</div> : null}
          {snapshot?.stale ? <div className="settings-model-capability-note">{t('settings.providers.capability.stale')}</div> : null}
          {snapshot?.lastRefreshError ? (
            <div className="settings-model-capability-note settings-model-capability-note--warning">
              {t('settings.providers.capability.refreshFailed', { error: snapshot.lastRefreshError })}
            </div>
          ) : null}
          {effectiveModel.quota ? (
            <div className="settings-model-capability-note settings-model-capability-note--warning">
              {t('settings.providers.capability.quota', {
                time: effectiveModel.quota.exhaustedUntil ?? t('settings.providers.capability.unknown'),
                note: effectiveModel.quota.note ?? '',
              })}
            </div>
          ) : null}
          {effectiveModel.unavailableReason ? (
            <div className="settings-model-capability-note settings-model-capability-note--error">{effectiveModel.unavailableReason}</div>
          ) : null}
        </>
      ) : (
        <div className="settings-model-capability-note">
          {provider.catalogOwnership === 'user-managed'
            ? t('settings.providers.capability.userManagedDetail')
            : t('settings.providers.capability.modelMissing')}
        </div>
      )}
    </div>
  );
};
