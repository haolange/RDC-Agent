import React, { useState } from 'react';
import type { LlmProviderEntry } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { Button } from '../../../../ui/Button';
import { getProviderProtocolLabel } from '../utils';
import {
  countEnabledModels,
  isProviderActionBlocked,
  resolveProviderCardStatus,
  resolveProviderIdentity,
} from './providerCardModel';

type Translate = ReturnType<typeof useI18n>['t'];

interface ProviderCardProps {
  provider: LlmProviderEntry;
  label: string;
  onTest: (provider: LlmProviderEntry) => void | Promise<void>;
  onDisconnect: (provider: LlmProviderEntry) => void | Promise<void>;
  onOpenConnection: (provider: LlmProviderEntry) => void;
  t: Translate;
}

/**
 * Fixed five-band skeleton — identity / status / model summary / protocol /
 * actions — so cards stay the same height and the action row keeps its baseline
 * before, during and after a connection test.
 */
export const ProviderCard: React.FC<ProviderCardProps> = ({
  provider,
  label,
  onTest,
  onDisconnect,
  onOpenConnection,
  t,
}) => {
  const [errorExpanded, setErrorExpanded] = useState(false);
  const status = resolveProviderCardStatus(provider);
  const identity = resolveProviderIdentity(provider, t('settings.providerUnconfigured'));
  const modelCount = countEnabledModels(provider);
  const blocked = isProviderActionBlocked(provider);
  const protocolLabel = getProviderProtocolLabel(provider.protocol);
  const routeCount = provider.routeCount ?? 1;

  return (
    <article
      className={`settings-provider-card is-tone-${status.tone}`}
      data-testid={`settings-provider-card-${provider.id}`}
    >
      <header className="settings-provider-card-identity">
        <span className="settings-provider-card-glyph" aria-hidden="true">
          {label.slice(0, 1).toUpperCase()}
        </span>
        <span className="settings-provider-card-name" title={label}>{label}</span>
        <span className="settings-provider-card-models">
          {t('settings.providerModelCount', { count: modelCount })}
        </span>
      </header>

      <div className="settings-provider-card-status">
        <span className="settings-provider-card-dot" aria-hidden="true" />
        <span className="settings-provider-card-status-label">{t(status.labelKey)}</span>
      </div>

      <dl className="settings-provider-card-summary">
        <div className="settings-provider-card-summary-row">
          <dt>{t('settings.providerIdentity')}</dt>
          <dd className={identity.isPlaceholder ? 'is-placeholder' : undefined} title={identity.value}>
            {identity.value}
          </dd>
        </div>
        <div className="settings-provider-card-summary-row">
          <dt>{t('settings.providerProtocol')}</dt>
          <dd title={protocolLabel}>
            {routeCount > 1
              ? t('settings.providerProtocolMulti', { protocol: protocolLabel, count: routeCount })
              : protocolLabel}
          </dd>
        </div>
      </dl>

      {status.detail ? (
        <div className="settings-provider-card-error">
          <button
            type="button"
            className="settings-provider-card-error-toggle"
            aria-expanded={errorExpanded}
            data-testid={`settings-provider-error-toggle-${provider.id}`}
            onClick={() => setErrorExpanded((current) => !current)}
          >
            {errorExpanded ? t('settings.providerErrorCollapse') : t('settings.providerErrorExpand')}
          </button>
          {errorExpanded ? (
            <p className="settings-provider-card-error-detail">{status.detail}</p>
          ) : null}
        </div>
      ) : null}

      <footer className="settings-provider-card-actions">
        {provider.isConfigured ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              data-testid={`settings-provider-test-${provider.id}`}
              disabled={blocked}
              onClick={() => void onTest(provider)}
            >
              {t('settings.test')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              data-testid={`settings-provider-disconnect-${provider.id}`}
              onClick={() => void onDisconnect(provider)}
            >
              {provider.authMode === 'account' ? t('settings.signOut') : t('settings.disconnect')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="settings-provider-card-primary"
              data-testid={`settings-provider-connect-${provider.id}`}
              disabled={blocked}
              onClick={() => onOpenConnection(provider)}
            >
              {t('settings.edit')}
            </Button>
          </>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            className="settings-provider-card-primary"
            data-testid={`settings-provider-connect-${provider.id}`}
            disabled={blocked}
            onClick={() => onOpenConnection(provider)}
          >
            {blocked ? t('settings.providerUnavailableAction') : t('settings.connect')}
          </Button>
        )}
      </footer>
    </article>
  );
};
