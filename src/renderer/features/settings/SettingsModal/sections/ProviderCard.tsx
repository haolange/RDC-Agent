import React from 'react';
import { Button } from '../../../../ui/Button';
import { countEnabledModels, isProviderActionBlocked, resolveProviderCardStatus } from './providerCardModel';
import type { LlmProviderEntry } from '@shared/types/settings';
import type { TranslationKey, useI18n } from '../../../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];

/** How a service that is not connected yet connects, in the person's words. */
function connectHintKey(provider: LlmProviderEntry): TranslationKey {
  if (provider.authMode === 'account') {
    return provider.accountLogin?.mode === 'device' ? 'settings.providers.row.deviceCode' : 'settings.providers.row.browserLogin';
  }
  if (provider.authMode === 'local') return 'settings.providers.row.noKey';
  if (provider.authMode === 'environment') return 'settings.providers.row.environment';
  return 'settings.providers.row.apiKey';
}

interface ProviderCardProps {
  provider: LlmProviderEntry;
  label: string;
  onDisconnect: (provider: LlmProviderEntry) => void | Promise<void>;
  onOpenConnection: (provider: LlmProviderEntry) => void;
  t: Translate;
}

/** One service: who it is, whether it is connected, how many of its models are on, and what you can do with it. */
export const ProviderCard: React.FC<ProviderCardProps> = ({ provider, label, onDisconnect, onOpenConnection, t }) => {
  const status = resolveProviderCardStatus(provider);
  const blocked = isProviderActionBlocked(provider);
  const tone = provider.isConfigured ? status.tone : 'neutral';

  return (
    <article className={`settings-provider-card is-tone-${tone}`} data-testid={`settings-provider-card-${provider.id}`}>
      <header className="settings-provider-card-identity">
        <span className="settings-provider-card-glyph" aria-hidden="true">{label.slice(0, 1).toUpperCase()}</span>
        <span className="settings-provider-card-name">{label}</span>
      </header>

      <div className="settings-provider-card-status">
        <span className="settings-provider-card-dot" aria-hidden="true" />
        <span className="settings-provider-card-status-label">
          {provider.isConfigured || blocked ? t(status.labelKey) : t(connectHintKey(provider))}
        </span>
        <span className="settings-provider-card-models">{t('settings.providerModelCount', { count: countEnabledModels(provider) })}</span>
      </div>

      <footer className="settings-provider-card-actions">
        {provider.isConfigured ? (
          <Button variant="ghost" size="sm" data-testid={`settings-provider-disconnect-${provider.id}`}
            onClick={() => void onDisconnect(provider)}>
            {provider.authMode === 'account' ? t('settings.signOut') : t('settings.disconnect')}
          </Button>
        ) : null}
        <Button variant="secondary" size="sm" className="settings-provider-card-primary"
          data-testid={`settings-provider-connect-${provider.id}`} disabled={blocked}
          onClick={() => onOpenConnection(provider)}>
          {blocked ? t('settings.providerUnavailableAction') : provider.isConfigured ? t('settings.edit') : t('settings.connect')}
        </Button>
      </footer>
    </article>
  );
};
