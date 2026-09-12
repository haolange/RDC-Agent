import React, { useMemo, useState } from 'react';
import type { LlmProviderEntry } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { EmptyState } from '../../../../ui/EmptyState';
import { SearchField } from '../../../../ui/SearchField';
import type { ProviderCatalogCategory } from '../types';
import { getProviderCategoryTranslation } from '../utils';
import { ProviderCard } from './ProviderCard';
import { isProviderActionBlocked } from './providerCardModel';

type Translate = ReturnType<typeof useI18n>['t'];

interface ProvidersSettingsProps {
  accountProviders: LlmProviderEntry[];
  providerCatalog: LlmProviderEntry[];
  providerCatalogCategories: ProviderCatalogCategory[];
  getResolvedProviderLabel: (provider: Pick<LlmProviderEntry, 'label'>) => string;
  onRefreshProviderModels: (provider: LlmProviderEntry) => void | Promise<void>;
  onDisconnectProvider: (provider: LlmProviderEntry) => void | Promise<void>;
  onOpenProviderConnection: (provider: LlmProviderEntry) => void;
  t: Translate;
}

export const ProvidersSettings: React.FC<ProvidersSettingsProps> = ({
  accountProviders,
  providerCatalog,
  providerCatalogCategories,
  getResolvedProviderLabel,
  onRefreshProviderModels,
  onDisconnectProvider,
  onOpenProviderConnection,
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

  const visibleAccounts = accountProviders.filter((provider) => !isProviderActionBlocked(provider) && matchesQuery(provider));
  const visibleCatalog = providerCatalog.filter((provider) => !isProviderActionBlocked(provider) && matchesQuery(provider));
  const upcoming = [...accountProviders, ...providerCatalog]
    .filter((provider) => isProviderActionBlocked(provider) && matchesQuery(provider));

  const renderCard = (provider: LlmProviderEntry) => (
    <ProviderCard
      key={provider.id}
      provider={provider}
      label={getResolvedProviderLabel(provider)}
      onTest={onRefreshProviderModels}
      onDisconnect={onDisconnectProvider}
      onOpenConnection={onOpenProviderConnection}
      t={t}
    />
  );

  const renderGroup = (
    title: string,
    subtitle: string,
    providers: LlmProviderEntry[],
    testId: string,
  ) => (
    <section className="settings-provider-group" data-testid={testId} key={testId}>
      <header className="settings-section-header">
        <div>
          <div className="settings-section-title">{title}</div>
          {subtitle ? <div className="settings-section-subtitle">{subtitle}</div> : null}
        </div>
      </header>
      <div className="settings-provider-grid">{providers.map(renderCard)}</div>
    </section>
  );

  // Every projected category stays visible; only empty ones collapse away.
  const categoryIds = new Set(providerCatalogCategories.map((category) => category.id));
  const extraGroups = Array.from(new Set(
    visibleCatalog.map((provider) => provider.category).filter((group) => !categoryIds.has(group)),
  ));
  const catalogSections = [
    ...providerCatalogCategories,
    ...extraGroups.map((group) => ({ id: group, label: group, description: '' })),
  ]
    .filter((category) => category.id !== 'login-authorization')
    .map((category) => ({
      category,
      providers: visibleCatalog.filter((provider) => provider.category === category.id),
    }))
    .filter(({ providers }) => providers.length > 0);

  const nothingVisible = visibleAccounts.length === 0
    && visibleCatalog.length === 0
    && upcoming.length === 0;

  return (
    <>
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

      {visibleAccounts.length > 0
        ? renderGroup(t('settings.oauthAccounts'), '', visibleAccounts, 'settings-oauth-accounts')
        : null}

      {catalogSections.map(({ category, providers }) => renderGroup(
        t(getProviderCategoryTranslation(category.id).label),
        t(getProviderCategoryTranslation(category.id).description),
        providers,
        `settings-provider-group-${category.id}`,
      ))}

      {upcoming.length > 0 ? (
        <details className="settings-provider-upcoming" data-testid="settings-provider-upcoming">
          <summary className="settings-provider-upcoming-summary">
            <span>{t('settings.providers.upcoming')}</span>
            <span>{t('settings.providerCount', { count: upcoming.length })}</span>
          </summary>
          <div className="settings-provider-upcoming-body">
            <div className="settings-section-subtitle">{t('settings.providers.upcomingHint')}</div>
            <div className="settings-provider-grid">{upcoming.map(renderCard)}</div>
          </div>
        </details>
      ) : null}
    </>
  );
};
