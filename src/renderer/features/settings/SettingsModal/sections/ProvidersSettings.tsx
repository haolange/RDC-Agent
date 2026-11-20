import React, { useMemo, useState } from 'react';
import { Details } from '../../../../ui/Details';
import { EmptyState } from '../../../../ui/EmptyState';
import { ListRow } from '../../../../ui/ListRow';
import { SearchField } from '../../../../ui/SearchField';
import { getProviderCategoryTranslation } from '../utils';
import { ProviderProbeBatchPanel } from './ProviderProbeBatchPanel';
import { countEnabledModels, isProviderActionBlocked, resolveProviderCardStatus } from './providerCardModel';
import type { ProviderCatalogCategory } from '../types';
import type { LlmProviderEntry } from '@shared/types/settings';
import type { TranslationKey, useI18n } from '../../../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];

interface ProvidersSettingsProps {
  accountProviders: LlmProviderEntry[];
  providerCatalog: LlmProviderEntry[];
  providerCatalogCategories: ProviderCatalogCategory[];
  getResolvedProviderLabel: (provider: Pick<LlmProviderEntry, 'label'>) => string;
  onOpenProviderConnection: (provider: LlmProviderEntry) => void;
  /** The provider whose detail is open beside the list. */
  selectedProviderId: string | null;
  /** The selected provider's detail pane; absent until a provider is chosen. */
  detail: React.ReactNode;
  t: Translate;
}

/** How a not-yet-connected provider connects, in the person's words. */
function connectHintKey(provider: LlmProviderEntry): TranslationKey {
  if (provider.authMode === 'account') {
    return provider.accountLogin?.mode === 'device' ? 'settings.providers.row.deviceCode' : 'settings.providers.row.browserLogin';
  }
  if (provider.authMode === 'local') return 'settings.providers.row.noKey';
  if (provider.authMode === 'environment') return 'settings.providers.row.environment';
  return 'settings.providers.row.apiKey';
}

const ProviderRow: React.FC<{
  provider: LlmProviderEntry;
  label: string;
  selected: boolean;
  onSelect: (provider: LlmProviderEntry) => void;
  t: Translate;
}> = ({ provider, label, selected, onSelect, t }) => {
  const status = resolveProviderCardStatus(provider);
  const blocked = isProviderActionBlocked(provider);
  const line = blocked
    ? t('settings.providerUnavailableAction')
    : !provider.isConfigured
      ? t(connectHintKey(provider))
      : status.tone === 'error'
        ? t(status.labelKey)
        : t('settings.providers.row.modelsAvailable', { count: countEnabledModels(provider) });
  return (
    <ListRow
      className={`settings-provider-row is-tone-${provider.isConfigured ? status.tone : 'neutral'}`}
      data-testid={`settings-provider-row-${provider.id}`}
      selected={selected}
      disabled={blocked}
      title={status.detail || undefined}
      leading={<span className="settings-provider-row-glyph" aria-hidden="true">{label.slice(0, 1).toUpperCase()}</span>}
      trailing={provider.isConfigured ? <span className="settings-provider-row-dot" aria-hidden="true" /> : undefined}
      onClick={() => onSelect(provider)}
    >
      <span className="settings-provider-row-name">{label}</span>
      <span className="settings-provider-row-status">{line}</span>
    </ListRow>
  );
};

/**
 * Model services as a list beside the selected service's detail: connected services first, then what can
 * be added, grouped the way people connect them. Upcoming services and the batch capability check fold away.
 */
export const ProvidersSettings: React.FC<ProvidersSettingsProps> = ({
  accountProviders,
  providerCatalog,
  providerCatalogCategories,
  getResolvedProviderLabel,
  onOpenProviderConnection,
  selectedProviderId,
  detail,
  t,
}) => {
  const [query, setQuery] = useState('');
  const matchesQuery = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (provider: LlmProviderEntry) => !needle || [
      provider.id,
      provider.label,
      ...provider.models.map((model) => `${model.id} ${model.label ?? ''}`),
    ].join(' ').toLocaleLowerCase().includes(needle);
  }, [query]);

  const all = [...accountProviders, ...providerCatalog];
  const connected = all.filter((provider) => provider.isConfigured && !isProviderActionBlocked(provider) && matchesQuery(provider));
  const addableAccounts = accountProviders.filter((provider) => !provider.isConfigured && !isProviderActionBlocked(provider) && matchesQuery(provider));
  const addableCatalog = providerCatalog.filter((provider) => !provider.isConfigured && !isProviderActionBlocked(provider) && matchesQuery(provider));
  const upcoming = all.filter((provider) => isProviderActionBlocked(provider) && matchesQuery(provider));

  const categoryIds = new Set(providerCatalogCategories.map((category) => category.id));
  const extraGroups = Array.from(new Set(addableCatalog.map((provider) => provider.category).filter((group) => !categoryIds.has(group))));
  const catalogSections = [
    ...providerCatalogCategories,
    ...extraGroups.map((group) => ({ id: group, label: group, description: '' })),
  ]
    .filter((category) => category.id !== 'login-authorization')
    .map((category) => ({ category, providers: addableCatalog.filter((provider) => provider.category === category.id) }))
    .filter(({ providers }) => providers.length > 0);

  const renderRow = (provider: LlmProviderEntry) => (
    <ProviderRow key={provider.id} provider={provider} label={getResolvedProviderLabel(provider)}
      selected={provider.id === selectedProviderId} onSelect={onOpenProviderConnection} t={t} />
  );
  const renderGroup = (title: string, providers: LlmProviderEntry[], testId: string) => (
    <section className="settings-provider-group" data-testid={testId} key={testId}>
      <h3 className="settings-provider-group-title">{title}</h3>
      <div className="settings-provider-rows" role="list">{providers.map(renderRow)}</div>
    </section>
  );
  const nothingVisible = connected.length + addableAccounts.length + addableCatalog.length + upcoming.length === 0;

  return (
    <div className="settings-providers-layout">
      <div className="settings-provider-list-pane">
        <SearchField
          className="settings-provider-search"
          value={query}
          aria-label={t('settings.searchProviders')}
          placeholder={t('settings.searchProviders')}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery('')}
          clearLabel={t('app.clearSearch')}
          data-testid="settings-provider-search"
        />
        {nothingVisible ? <EmptyState title={t('settings.providerSearchEmpty')} /> : null}
        {connected.length > 0
          ? renderGroup(t('settings.providers.connectedGroup', { count: connected.length }), connected, 'settings-provider-connected')
          : null}
        {addableAccounts.length > 0 ? renderGroup(t('settings.oauthAccounts'), addableAccounts, 'settings-oauth-accounts') : null}
        {catalogSections.map(({ category, providers }) => renderGroup(
          t(getProviderCategoryTranslation(category.id).label),
          providers,
          `settings-provider-group-${category.id}`,
        ))}
        {upcoming.length > 0 ? (
          <Details className="settings-provider-upcoming" data-testid="settings-provider-upcoming" summaryClassName="settings-provider-upcoming-summary" summary={<>
            <span>{t('settings.providers.upcoming')}</span>
            <span>{t('settings.providerCount', { count: upcoming.length })}</span>
          </>}>
            <div className="settings-provider-upcoming-body">
              <p className="settings-section-subtitle">{t('settings.providers.upcomingHint')}</p>
              <div className="settings-provider-rows" role="list">{upcoming.map(renderRow)}</div>
            </div>
          </Details>
        ) : null}
        <Details className="settings-provider-probe-disclosure" data-testid="settings-provider-probe-disclosure" summary={t('settings.providers.capabilityCheck')}>
          <ProviderProbeBatchPanel t={t} />
        </Details>
      </div>
      <div className="settings-provider-detail-pane">
        {detail ?? <EmptyState className="settings-provider-detail-empty" title={t('settings.providers.selectHint')} />}
      </div>
    </div>
  );
};
