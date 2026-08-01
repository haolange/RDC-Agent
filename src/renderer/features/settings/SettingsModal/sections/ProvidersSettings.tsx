import React from 'react';
import type { LlmProviderEntry } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import type { ProviderCatalogCategory } from '../types';
import {
  getEnabledModels,
  getModelSummary,
  getProviderCategoryTranslation,
  getProviderProtocolLabel,
  getProviderStatusLabel,
} from '../utils';

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
  const shouldCollapseAsUpcoming = (provider: LlmProviderEntry) => !provider.isConfigured
    && provider.providerAvailability.state === 'unavailable';
  const visibleAccountProviders = accountProviders.filter((provider) => !shouldCollapseAsUpcoming(provider));
  const visibleProviderCatalog = providerCatalog.filter((provider) => !shouldCollapseAsUpcoming(provider));
  const upcomingProviders = [...accountProviders, ...providerCatalog]
    .filter(shouldCollapseAsUpcoming);
  const renderProviderRow = (provider: LlmProviderEntry, mode: 'account' | 'connected' | 'add') => {
    const models = getEnabledModels(provider);
    const connected = provider.isConfigured && provider.status === 'verified';
    const unavailable = Boolean(provider.unavailableReason && provider.unavailableReason.trim());
    const showConfiguredActions = provider.isConfigured;
    const primaryDisabled = unavailable && !provider.isConfigured;
    const primaryLabel = provider.isConfigured
      ? t('settings.edit')
      : primaryDisabled
        ? t('settings.providerUnavailableAction')
        : t('settings.connect');
    const rowClassName = [
      'settings-provider-row',
      connected ? 'connected' : '',
      unavailable ? 'settings-provider-row--unavailable' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const statusClassName = unavailable ? 'unavailable' : connected ? 'configured' : 'pending';
    const protocolLabel = getProviderProtocolLabel(provider.protocol);
    const multiProtocol = (provider.routeCount ?? 1) > 1;
    const protocolMetaValue = multiProtocol
      ? t('settings.providerProtocolMulti', { protocol: protocolLabel, count: provider.routeCount ?? 0 })
      : protocolLabel;
    const showProtocolMeta = provider.authMode !== 'account';
    const statusSummary = unavailable
      ? t('settings.providerUnavailable')
      : provider.authMode === 'account'
        ? [
          t(getProviderStatusLabel(provider)),
          provider.accountLabel,
          provider.planLabel,
          getModelSummary(models, ''),
        ].filter(Boolean).join(' / ')
        : [
          connected ? t('settings.providerConnected') : t('settings.providerUnconfigured'),
          getModelSummary(models, t('settings.noEnabledModels')),
        ].filter(Boolean).join(' / ');

    return (
      <div
        key={provider.id}
        className={rowClassName}
        data-testid={`settings-${mode === 'account' ? 'oauth-row' : 'provider-row'}-${provider.id}`}
        title={unavailable ? provider.unavailableReason : undefined}
      >
        <div className="settings-provider-row-main">
          <span className="settings-provider-icon-shell">
            <span className="settings-provider-icon">{getResolvedProviderLabel(provider).slice(0, 1).toUpperCase()}</span>
            <span className={`settings-provider-status ${statusClassName}`} aria-label={t(getProviderStatusLabel(provider))} title={t(getProviderStatusLabel(provider))} />
          </span>
          <span className="settings-provider-row-copy">
            <span className="settings-provider-row-titleline">
              <span className="settings-provider-item-label">{getResolvedProviderLabel(provider)}</span>
            </span>
            {statusSummary ? <span className="settings-provider-item-meta">{statusSummary}</span> : null}
            {showProtocolMeta ? (
              <span className="settings-provider-protocol-meta" title={protocolMetaValue}>
                <span className="settings-provider-protocol-meta-label">{t('settings.providerProtocol')}</span>
                <span className="settings-provider-protocol-meta-value">{protocolMetaValue}</span>
              </span>
            ) : null}
          </span>
        </div>
        {showConfiguredActions ? (
          <div className="settings-provider-row-actions settings-provider-row-actions--configured">
            <button
              type="button"
              className="button button-secondary settings-provider-row-button"
              data-testid={`settings-provider-test-${provider.id}`}
              onClick={() => void onRefreshProviderModels(provider)}
              disabled={unavailable}
            >
              {t('settings.test')}
            </button>
            <button
              type="button"
              className="button button-ghost settings-provider-row-button"
              data-testid={`settings-provider-disconnect-${provider.id}`}
              onClick={() => void onDisconnectProvider(provider)}
            >
              {provider.authMode === 'account' ? t('settings.signOut') : t('settings.disconnect')}
            </button>
            <button
              type="button"
              className="button button-primary settings-provider-row-button settings-provider-row-button--primary"
              data-testid={`settings-provider-connect-${provider.id}`}
              onClick={() => onOpenProviderConnection(provider)}
              disabled={primaryDisabled}
            >
              {primaryLabel}
            </button>
          </div>
        ) : (
          <div className="settings-provider-row-actions">
            <button
              type="button"
              className="button button-secondary settings-provider-row-button"
              data-testid={`settings-provider-connect-${provider.id}`}
              onClick={() => onOpenProviderConnection(provider)}
              disabled={primaryDisabled}
            >
              {primaryLabel}
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderProviderGroup = (
    title: string,
    subtitle: string,
    providers: LlmProviderEntry[],
    testId: string,
    mode: 'account' | 'connected' | 'add',
  ) => (
    <div className="settings-provider-section settings-provider-section-flat" data-testid={testId}>
      <div className="settings-section-header">
        <div>
          <div className="settings-section-title">{title}</div>
          {subtitle ? <div className="settings-section-subtitle">{subtitle}</div> : null}
        </div>
      </div>
      <div className="settings-provider-row-list" data-empty-label={t('settings.noProvidersInGroup')}>
        {providers.map((provider) => renderProviderRow(provider, mode))}
      </div>
    </div>
  );

  const categoryIds = new Set(providerCatalogCategories.map((category) => category.id));
  const uncategorizedGroups = Array.from(new Set(
    visibleProviderCatalog
      .map((provider) => provider.category)
      .filter((group) => !categoryIds.has(group)),
  ));
  const catalogSections = [
    ...providerCatalogCategories,
    ...uncategorizedGroups.map((group) => ({
      id: group,
      label: group,
      description: '',
    })),
  ].filter((category) => category.id !== 'login-authorization')
    .map((category) => ({
      category,
      providers: visibleProviderCatalog.filter((provider) => provider.category === category.id),
    }))
    .filter(({ providers }) => providers.length > 0);

  return (
    <>
      {renderProviderGroup(
        t('settings.oauthAccounts'),
        '',
        visibleAccountProviders,
        'settings-oauth-accounts',
        'account',
      )}
      <div className="settings-provider-catalog-groups" data-testid="settings-add-provider">
        {catalogSections.map(({ category, providers }) => (
          <React.Fragment key={category.id}>
            {renderProviderGroup(
              t(getProviderCategoryTranslation(category.id).label),
              t(getProviderCategoryTranslation(category.id).description),
              providers,
              `settings-provider-group-${category.id}`,
              'add',
            )}
          </React.Fragment>
        ))}
      </div>
      {upcomingProviders.length > 0 ? (
        <details className="settings-provider-upcoming" data-testid="settings-provider-upcoming">
          <summary className="settings-provider-upcoming-summary">
            <span>{t('settings.providers.upcoming')}</span>
            <span>{t('settings.providerCount', { count: upcomingProviders.length })}</span>
          </summary>
          <div className="settings-provider-upcoming-body">
            <div className="settings-section-subtitle">{t('settings.providers.upcomingHint')}</div>
            <div className="settings-provider-row-list">
              {upcomingProviders.map((provider) => renderProviderRow(provider, 'add'))}
            </div>
          </div>
        </details>
      ) : null}
    </>
  );
};
