import React from 'react';
import { Switch } from '../../../../ui/Switch';
import { Button } from '../../../../ui/Button';
import { resolveProviderModelAvailabilityBadge } from '../providerModelAvailabilityBadge';
import { Chevron } from '../../../../ui/Chevron';
import { formatContextCapability } from '../modelCapabilitySummaryUtils';
import { ProviderModelCapabilityIcons } from './ProviderModelCapabilityIcons';
import { ProviderModelCapabilitySummary } from './ProviderModelCapabilitySummary';
import type { EffectiveCatalogSnapshot, EffectiveModel } from '@shared/types/providerCapability';
import type { LlmProviderEntry, LlmProviderModel } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];

interface ProviderConnectModelRowProps {
  provider: Pick<LlmProviderEntry, 'id' | 'catalogOwnership' | 'activeAccountId' | 'protocol' | 'isConfigured' | 'serviceOperator' | 'authMode'>;
  model: LlmProviderModel;
  effectiveModel: EffectiveModel | null;
  snapshot: EffectiveCatalogSnapshot | null;
  loading: boolean;
  loadFailed: boolean;
  expanded: boolean;
  disabled?: boolean;
  onToggleExpanded: (modelId: string) => void;
  onModelChange: (modelId: string, patch: Partial<LlmProviderModel>) => void;
  t: Translate;
}

export const ProviderConnectModelRow: React.FC<ProviderConnectModelRowProps> = ({
  provider,
  model,
  effectiveModel,
  snapshot,
  loading,
  loadFailed,
  expanded,
  disabled = false,
  onToggleExpanded,
  onModelChange,
  t,
}) => {
  const availability = effectiveModel?.availability ?? model.availability ?? 'unknown';
  const refreshError = snapshot?.lastRefreshError ?? (loadFailed ? t('settings.providers.modelRefreshFailedReason') : undefined);
  const badge = resolveProviderModelAvailabilityBadge({
    availability,
    enabled: model.enabled,
    loading,
    refreshing: snapshot?.refreshing === true,
    refreshError,
  });
  const isUnavailable = badge === 'unavailable';
  const statusLabel = badge === 'unavailable'
    ? t('settings.providers.modelUnavailable')
    : badge === 'disabled'
      ? t('settings.providers.modelDisabled')
      : badge === 'loading'
        ? t('settings.providers.modelLoading')
        : badge === 'refresh-failed'
          ? t('settings.providers.modelRefreshFailed')
          : badge === 'unverified'
            ? t('settings.providers.modelUnverified')
            : t('settings.providers.modelAvailable');
  const statusTitle = isUnavailable
    ? t('settings.providers.modelUnavailableReason')
    : badge === 'refresh-failed'
      ? t('settings.providers.modelRefreshFailedReason')
      : badge === 'unverified'
        ? t('settings.providers.modelUnverifiedReason')
        : undefined;

  return (
    <div
      className={`settings-model-row${expanded ? ' is-expanded' : ''}${isUnavailable || !model.enabled ? ' is-disabled' : ''}`}
      data-testid={`settings-provider-model-row-${model.id}`}
      data-availability-badge={badge}
    >
      <div className="settings-model-row-main">
        <span className="settings-model-row-identity">
          <span className="settings-model-row-label">{model.label}</span>
          {effectiveModel ? <span className="settings-model-row-context">{formatContextCapability(effectiveModel, t)}</span> : null}
        </span>
        <span className={`settings-model-row-check is-${badge}`} data-tooltip={statusTitle}>{statusLabel}</span>
        <span className="settings-model-row-capabilities"><ProviderModelCapabilityIcons model={effectiveModel} t={t} /></span>
        <Switch
          checked={model.enabled}
          disabled={disabled || isUnavailable}
          onCheckedChange={(enabled) => onModelChange(model.id, { enabled })}
          aria-label={t('settings.providers.capability.modelEnabled', { model: model.label })}
        />
        <Button
          variant="ghost" size="sm" className="settings-model-capability-toggle"
          aria-expanded={expanded}
          aria-label={`${t('settings.providers.capability.toggle')} · ${model.label}`}
          data-tooltip={t('settings.providers.capability.toggle')}
          disabled={disabled}
          data-testid={`settings-provider-model-capability-toggle-${model.id}`}
          onClick={() => onToggleExpanded(model.id)}
        >
          <Chevron direction="down" open={expanded} />
        </Button>
      </div>
      {expanded ? (
        <ProviderModelCapabilitySummary
          provider={provider}
          model={model}
          effectiveModel={effectiveModel}
          snapshot={snapshot}
          loading={loading}
          loadFailed={loadFailed}
          onModelChange={(patch) => onModelChange(model.id, patch)}
          t={t}
        />
      ) : null}
    </div>
  );
};
