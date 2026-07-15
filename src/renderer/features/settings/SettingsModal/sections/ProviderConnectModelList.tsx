import React, { useEffect, useMemo, useState } from 'react';
import type { EffectiveCatalogSnapshot } from '@shared/types/providerCapability';
import type { LlmProviderEntry, LlmProviderModel } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { getElectronApi } from '../../../../platform/getElectronApi';
import { snapshotMatchesProvider } from '../modelCapabilitySummaryUtils';
import { projectProviderModels } from '../providerModelProjection';
import { ProviderConnectModelRow } from './ProviderConnectModelRow';

type Translate = ReturnType<typeof useI18n>['t'];

interface ProviderConnectModelListProps {
  provider: Pick<LlmProviderEntry, 'id' | 'catalogOwnership' | 'activeAccountId' | 'protocol' | 'isConfigured' | 'serviceOperator' | 'authMode'>;
  models: LlmProviderModel[];
  expandedModelId: string | null;
  disabled: boolean;
  onToggleExpanded: (modelId: string) => void;
  onModelChange: (modelId: string, patch: Partial<LlmProviderModel>) => void;
  onModelCountChange: (count: number) => void;
  t: Translate;
}

export const ProviderConnectModelList: React.FC<ProviderConnectModelListProps> = ({
  provider,
  models,
  expandedModelId,
  disabled,
  onToggleExpanded,
  onModelChange,
  onModelCountChange,
  t,
}) => {
  const [snapshot, setSnapshot] = useState<EffectiveCatalogSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSnapshot(null);
    setLoading(true);
    setLoadFailed(false);
    void getElectronApi()?.settings.getEffectiveCatalog(provider.id)
      .then((next) => {
        if (cancelled) return;
        setSnapshot(next && snapshotMatchesProvider(next, provider) ? next : null);
        setLoadFailed(false);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    const unsubscribe = getElectronApi()?.events.onEffectiveCatalogChanged((next) => {
      if (!cancelled && snapshotMatchesProvider(next, provider)) {
        setSnapshot(next);
        setLoading(false);
        setLoadFailed(false);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [provider.activeAccountId, provider.id, provider.protocol]);

  const resolvedModels = useMemo(
    () => projectProviderModels(provider.catalogOwnership, models, snapshot),
    [models, provider.catalogOwnership, snapshot],
  );
  useEffect(() => onModelCountChange(resolvedModels.length), [onModelCountChange, resolvedModels.length]);
  const allUnavailable = resolvedModels.length > 0 && resolvedModels.every(({ model, effectiveModel }) => (
    effectiveModel?.availability ?? model.availability
  ) === 'unavailable');

  return (
    <div className="settings-model-section settings-provider-connect-models" data-testid="settings-provider-connect-models">
      <div className="settings-model-section-header">
        <span>{provider.catalogOwnership !== 'user-managed'
          ? t('settings.providers.capability.appManagedModels')
          : t('settings.providers.capability.userManagedModels')}</span>
        <span className="settings-help-text">
          {t('settings.providerModelCount', { count: resolvedModels.length })}
        </span>
      </div>
      {provider.catalogOwnership !== 'user-managed' ? (
        <div className="settings-provider-notice" data-testid="settings-provider-app-managed-models">
          {t('settings.providers.capability.appManagedProviderHint')}
        </div>
      ) : (
        <div className="settings-provider-notice" data-testid="settings-provider-user-managed-models">
          {t('settings.providers.capability.userManagedProviderHint')}
        </div>
      )}
      {allUnavailable ? (
        <div className="settings-provider-notice" data-testid="settings-provider-connect-unavailable-hint">
          {t('settings.providers.allModelsUnavailableHint')}
        </div>
      ) : null}
      <div className="settings-model-list" data-empty-label={t('settings.testBeforeSaveHint')}>
        {resolvedModels.map(({ model, effectiveModel }) => (
          <ProviderConnectModelRow
            key={model.id}
            provider={provider}
            model={model}
            effectiveModel={effectiveModel}
            snapshot={snapshot}
            loading={loading}
            loadFailed={loadFailed}
            expanded={expandedModelId === model.id}
            disabled={disabled}
            onToggleExpanded={onToggleExpanded}
            onModelChange={(modelId, patch) => onModelChange(modelId, { ...model, ...patch })}
            t={t}
          />
        ))}
      </div>
    </div>
  );
};
