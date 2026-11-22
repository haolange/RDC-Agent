import React, { useMemo, useState } from 'react';
import { Details } from '../../../../ui/Details';
import { EmptyState } from '../../../../ui/EmptyState';
import { SearchField } from '../../../../ui/SearchField';
import { getProviderCategoryTranslation } from '../utils';
import { ProviderCard } from './ProviderCard';
import { ProviderProbeBatchPanel } from './ProviderProbeBatchPanel';
import { isProviderActionBlocked } from './providerCardModel';
import type { ProviderCatalogCategory } from '../types';
import type { LlmProviderEntry } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];

interface ProvidersSettingsProps {
  accountProviders: LlmProviderEntry[];
  providerCatalog: LlmProviderEntry[];
  providerCatalogCategories: ProviderCatalogCategory[];
  getResolvedProviderLabel: (provider: Pick<LlmProviderEntry, 'label'>) => string;
  onDisconnectProvider: (provider: LlmProviderEntry) => void | Promise<void>;
  onOpenProviderConnection: (provider: LlmProviderEntry) => void;
  t: Translate;
}

/**
 * Model services as cards, grouped the way people connect them, each group with one sentence on what it is.
 * Opening a card brings up that service's panel; services that are not available yet fold away at the end.
 */
export const ProvidersSettings: React.FC<ProvidersSettingsProps> = ({
  accountProviders,
  providerCatalog,
  providerCatalogCategories,
  getResolvedProviderLabel,
  onDisconnectProvider,
  onOpenProviderConnection,
  t,
}) => {
  const [query, setQuery] = useState('');
  const matchesQuery = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (provider: LlmProviderEntry) => !needle || [
      provider.label,
      ...provider.models.map((model) => model.label ?? model.id),
    ].join(' ').toLocaleLowerCase().includes(needle);
  }, [query]);

  const visibleAccounts = accountProviders.filter((provider) => !isProviderActionBlocked(provider) && matchesQuery(provider));
  const visibleCatalog = providerCatalog.filter((provider) => !isProviderActionBlocked(provider) && matchesQuery(provider));
  const upcoming = [...accountProviders, ...providerCatalog].filter((provider) => isProviderActionBlocked(provider) && matchesQuery(provider));

  const categoryIds = new Set(providerCatalogCategories.map((category) => category.id));
  const extraGroups = Array.from(new Set(visibleCatalog.map((provider) => provider.category).filter((group) => !categoryIds.has(group))));
  const catalogSections = [
    ...providerCatalogCategories,
    ...extraGroups.map((group) => ({ id: group, label: group, description: '' })),
  ]
    .filter((category) => category.id !== 'login-authorization')
    .map((category) => ({ category, providers: visibleCatalog.filter((provider) => provider.category === category.id) }))
    .filter(({ providers }) => providers.length > 0);

  const renderCard = (provider: LlmProviderEntry) => (
    <ProviderCard key={provider.id} provider={provider} label={getResolvedProviderLabel(provider)}
      onDisconnect={onDisconnectProvider} onOpenConnection={onOpenProviderConnection} t={t} />
  );
  const renderGroup = (title: string, description: string, providers: LlmProviderEntry[], testId: string) => (
    <section className="settings-provider-group" data-testid={testId} key={testId}>
      <header className="settings-provider-group-head">
        <h3 className="settings-provider-group-title">{title}</h3>
        {description ? <p className="settings-section-description">{description}</p> : null}
      </header>
      <div className="settings-provider-grid">{providers.map(renderCard)}</div>
    </section>
  );
  const nothingVisible = visibleAccounts.length + visibleCatalog.length + upcoming.length === 0;

  return (
    <>
      <ProviderProbeBatchPanel t={t} />
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
        ? renderGroup(t('settings.oauthAccounts'), t(getProviderCategoryTranslation('login-authorization').description),
          visibleAccounts, 'settings-oauth-accounts')
        : null}
      {catalogSections.map(({ category, providers }) => renderGroup(
        t(getProviderCategoryTranslation(category.id).label),
        t(getProviderCategoryTranslation(category.id).description),
        providers,
        `settings-provider-group-${category.id}`,
      ))}
      {upcoming.length > 0 ? (
        <Details className="settings-provider-upcoming" data-testid="settings-provider-upcoming"
          summaryClassName="settings-provider-upcoming-summary" summary={<>
            <span>{t('settings.providers.upcoming')}</span>
            <span>{t('settings.providerCount', { count: upcoming.length })}</span>
          </>}>
          <div className="settings-provider-upcoming-body">
            <p className="settings-section-description">{t('settings.providers.upcomingHint')}</p>
            <div className="settings-provider-grid">{upcoming.map(renderCard)}</div>
          </div>
        </Details>
      ) : null}
    </>
  );
};
