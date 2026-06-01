import React from 'react';
import type { LlmProviderEntry } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import {
  getEnabledModels,
  getModelSummary,
  getProviderGroupLabel,
  getProviderStatusLabel,
} from '../utils';

type Translate = ReturnType<typeof useI18n>['t'];

interface ProvidersSettingsProps {
  accountProviders: LlmProviderEntry[];
  providerCatalog: LlmProviderEntry[];
  getResolvedProviderLabel: (provider: Pick<LlmProviderEntry, 'label'>) => string;
  onRefreshProviderModels: (provider: LlmProviderEntry) => void | Promise<void>;
  onDisconnectProvider: (provider: LlmProviderEntry) => void | Promise<void>;
  onOpenProviderConnection: (provider: LlmProviderEntry) => void;
  t: Translate;
}

export const ProvidersSettings: React.FC<ProvidersSettingsProps> = ({
  accountProviders,
  providerCatalog,
  getResolvedProviderLabel,
  onRefreshProviderModels,
  onDisconnectProvider,
  onOpenProviderConnection,
  t,
}) => {
  const renderProviderRow = (provider: LlmProviderEntry, mode: 'account' | 'connected' | 'add') => {
    const models = getEnabledModels(provider);
    const connected = provider.isConfigured && provider.status === 'verified';
    return (
      <div
        key={provider.id}
        className={`settings-provider-row ${connected ? 'connected' : ''}`}
        data-testid={`settings-${mode === 'account' ? 'oauth-row' : 'provider-row'}-${provider.id}`}
      >
        <div className="settings-provider-row-main">
          <span className={`settings-provider-status ${connected ? 'configured' : 'pending'}`} />
          <span className="settings-provider-icon">{getResolvedProviderLabel(provider).slice(0, 1).toUpperCase()}</span>
          <span className="settings-provider-row-copy">
            <span className="settings-provider-item-label">{getResolvedProviderLabel(provider)}</span>
            <span className="settings-provider-item-meta">
              {provider.authMode === 'account'
                ? [
                  t(getProviderStatusLabel(provider)),
                  provider.accountLabel,
                  provider.planLabel,
                  getModelSummary(models, ''),
                ].filter(Boolean).join(' · ')
                : [
                  getProviderGroupLabel(provider),
                  connected ? t('settings.providerConnected') : t('settings.providerUnconfigured'),
                  getModelSummary(models, t('settings.noEnabledModels')),
                ].filter(Boolean).join(' · ')}
            </span>
          </span>
        </div>
        <div className="settings-provider-row-actions">
          {(mode !== 'add' || provider.isConfigured) && (
            <button
              type="button"
              className="button button-secondary settings-provider-row-button"
              data-testid={`settings-provider-test-${provider.id}`}
              onClick={() => void onRefreshProviderModels(provider)}
              disabled={!provider.isConfigured}
            >
              {t('settings.test')}
            </button>
          )}
          {(mode !== 'add' || provider.isConfigured) && (
            <button
              type="button"
              className="button button-secondary settings-provider-row-button"
              data-testid={`settings-provider-disconnect-${provider.id}`}
              onClick={() => void onDisconnectProvider(provider)}
              disabled={!provider.isConfigured}
            >
              {provider.authMode === 'account' ? t('settings.signOut') : t('settings.disconnect')}
            </button>
          )}
          <button
            type="button"
            className="button button-primary settings-provider-row-button"
            data-testid={`settings-provider-connect-${provider.id}`}
            onClick={() => onOpenProviderConnection(provider)}
          >
            {provider.isConfigured ? t('settings.edit') : t('settings.connect')}
          </button>
        </div>
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
          <div className="settings-section-subtitle">{subtitle}</div>
        </div>
      </div>
      <div className="settings-provider-row-list" data-empty-label={t('settings.noProvidersInGroup')}>
        {providers.map((provider) => renderProviderRow(provider, mode))}
      </div>
    </div>
  );

  return (
    <>
      {renderProviderGroup(
        t('settings.oauthAccounts'),
        t('settings.oauthAccountsHint'),
        accountProviders,
        'settings-oauth-accounts',
        'account',
      )}
      {renderProviderGroup(
        t('settings.addProvider'),
        t('settings.addProviderHint'),
        providerCatalog,
        'settings-add-provider',
        'add',
      )}
    </>
  );
};
