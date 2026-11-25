import React, { useEffect, useMemo, useState } from 'react';
import { catalogScopeKey, useEffectiveCatalogStore } from '../../../../stores/effectiveCatalogStore';
import { projectProviderModels } from '../providerModelProjection';
import { InlineError } from '../../../../ui/InlineError';
import { SearchField } from '../../../../ui/SearchField';
import { useI18n } from '../../../../i18n';
import { ProviderConnectModelRow } from './ProviderConnectModelRow';
import type { LlmProviderEntry, LlmProviderModel } from '@shared/types/settings';

interface ProviderConnectModelListProps {
  provider: Pick<LlmProviderEntry, 'id' | 'catalogOwnership' | 'activeAccountId' | 'protocol' | 'isConfigured' | 'serviceOperator' | 'authMode'>;
  models: LlmProviderModel[];
  discoveryAccountId?: string | null;
  expandedModelId: string | null;
  disabled: boolean;
  onToggleExpanded: (modelId: string) => void;
  onModelChange: (modelId: string, patch: Partial<LlmProviderModel>) => void;
  onModelCountChange: (count: number) => void;
}

export const ProviderConnectModelList: React.FC<ProviderConnectModelListProps> = ({
  provider,
  models,
  discoveryAccountId = null,
  expandedModelId,
  disabled,
  onToggleExpanded,
  onModelChange,
  onModelCountChange,
}) => {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const catalogAccountId = discoveryAccountId?.trim() || provider.activeAccountId || `anonymous:${provider.id}`;
  const scope = useMemo(() => ({ id: provider.id, activeAccountId: catalogAccountId, protocol: provider.protocol }),
    [provider.id, provider.protocol, catalogAccountId]);
  const projection = useEffectiveCatalogStore((state) => state.entries[catalogScopeKey(scope)]);
  const snapshot = projection?.snapshot ?? null;
  const loading = !projection || projection.loading;
  const loadFailed = Boolean(projection?.error);
  // Settings reconciliation drops catalog entries of scopes that are not saved providers, which includes the draft this
  // panel discovers against. The panel owns its scope, so it asks again whenever its entry is dropped.
  const dropped = projection === undefined;
  useEffect(() => { void useEffectiveCatalogStore.getState().load(scope, false, true); }, [scope, dropped]);

  const resolvedModels = useMemo(
    () => projectProviderModels(provider.catalogOwnership, models, snapshot),
    [models, provider.catalogOwnership, snapshot],
  );
  const availableModelCount = useMemo(
    () => resolvedModels.filter(({ model, effectiveModel }) => (
      effectiveModel?.availability ?? model.availability
    ) === 'available').length,
    [resolvedModels],
  );
  useEffect(() => onModelCountChange(resolvedModels.length), [onModelCountChange, resolvedModels.length]);
  const allUnavailable = resolvedModels.length > 0 && resolvedModels.every(({ model, effectiveModel }) => (
    effectiveModel?.availability ?? model.availability
  ) === 'unavailable');
  const rowLoading = loading && !snapshot;
  const needle = query.trim().toLowerCase();
  const visibleModels = needle
    ? resolvedModels.filter(({ model, effectiveModel }) => [model.id, model.label, effectiveModel?.label]
      .some((field) => field?.toLowerCase().includes(needle)))
    : resolvedModels;
  const showSearch = resolvedModels.length > 5;

  return (
    <div className="settings-model-section settings-provider-connect-models" data-testid="settings-provider-connect-models">
      <div className="settings-model-section-header">
        <span className="settings-model-section-title">
          {provider.catalogOwnership !== 'user-managed'
            ? t('settings.providers.capability.appManagedModels')
            : t('settings.providers.capability.userManagedModels')}
        </span>
        <span className="settings-model-section-count">
          {t('settings.providerManagedModelCount', { available: availableModelCount, total: resolvedModels.length })}
        </span>
      </div>
      {snapshot?.lastRefreshError ? (
        <InlineError detail={snapshot.lastRefreshError}>{t('settings.providers.capability.refreshFailed')}</InlineError>
      ) : null}
      {allUnavailable ? (
        <div className="settings-provider-notice" data-testid="settings-provider-connect-unavailable-hint">
          {t('settings.providers.allModelsUnavailableHint')}
        </div>
      ) : null}
      {showSearch ? (
        <div className="settings-model-search">
          <SearchField
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery('')}
            clearLabel={t('app.clearSearch')}
            placeholder={t('settings.searchModelPlaceholder')}
            aria-label={t('settings.searchModelPlaceholder')}
            data-testid="settings-provider-model-search"
          />
        </div>
      ) : null}
      {resolvedModels.length > 0 ? (
        <div className="settings-model-columns" aria-hidden="true">
          <span>{t('settings.providers.columns.model')}</span>
          <span>{t('settings.providers.columns.availability')}</span>
          <span>{t('settings.providers.columns.capability')}</span>
          <span>{t('settings.providers.columns.enabled')}</span>
        </div>
      ) : null}
      <div className="settings-model-list scrollbar-thin" data-empty-label={t('settings.testBeforeSaveHint')} data-testid="settings-provider-model-list">
        {needle && visibleModels.length === 0 ? (
          <div className="settings-model-list-no-match" role="status">{t('settings.providers.noModelMatch')}</div>
        ) : null}
        {visibleModels.map(({ model, effectiveModel }) => (
          <ProviderConnectModelRow
            key={model.id}
            provider={provider}
            model={model}
            effectiveModel={effectiveModel}
            snapshot={snapshot}
            loading={rowLoading}
            loadFailed={loadFailed}
            expanded={expandedModelId === model.id}
            disabled={disabled}
            onToggleExpanded={onToggleExpanded}
            onModelChange={(modelId, patch) => onModelChange(modelId, { ...model, ...patch })}
          />
        ))}
      </div>
    </div>
  );
};
