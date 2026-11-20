import React, { useState } from 'react';
import { Button } from '../../../../ui/Button';
import { Details } from '../../../../ui/Details';
import { Icon } from '../../../../ui/Icon';
import { InlineError } from '../../../../ui/InlineError';
import { Input } from '../../../../ui/Input';
import { getProviderCategoryTranslation, getProviderProtocolLabel } from '../utils';
import { SettingsField } from '../parts';
import { shouldUseProviderDocsLink } from '../providerConnectionState';
import { hasProviderConnectionDefinitionChanged } from '../providerConnectionRequest';
import { ProviderAccountOAuthPanel } from './ProviderAccountOAuthPanel';
import { ProviderConnectionFields } from './ProviderConnectionFields';
import { ProviderAuthModeField } from './ProviderAuthModeField';
import { ProviderConnectModelList } from './ProviderConnectModelList';
import { ProviderConnectActions } from './ProviderConnectActions';
import { ProviderProbeBatchPanel } from './ProviderProbeBatchPanel';
import { ProviderConnectionStatusLine, ProviderDiscoveryEmpty, ProviderProtocolSummary, connectionPhase } from './ProviderConnectSummary';
import type { ProviderConnectionDraft } from '../types';
import type { LlmProviderEntry, LlmProviderModel } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];

interface ProviderDetailProps {
  connectionDraft: ProviderConnectionDraft;
  connectionProvider: LlmProviderEntry;
  getResolvedProviderLabel: (provider: Pick<LlmProviderEntry, 'label'>) => string;
  connectionAccountConnected: boolean;
  connectionDevicePending: boolean;
  connectionNeedsCredentials: boolean;
  connectionNeedsBaseUrl: boolean;
  connectionHasFreshTest: boolean;
  onClose: () => void;
  onUpdateConnectionDraft: (patch: Partial<ProviderConnectionDraft>) => void;
  onModelChange: (modelId: string, patch: Partial<LlmProviderModel>) => void;
  onTest: () => void | Promise<void>;
  onSave: () => void | Promise<void>;
  onStartAccountLogin: () => void | Promise<void>;
  onRefreshModels: (provider: LlmProviderEntry) => void | Promise<void>;
  onDisconnect: (provider: LlmProviderEntry) => void | Promise<void>;
  t: Translate;
}

/**
 * The selected provider beside the provider list: who it is, how it connects, its models, and — folded —
 * the technical facts (service id, protocol, endpoints) that only diagnosis needs.
 */
export const ProviderDetail: React.FC<ProviderDetailProps> = ({
  connectionDraft,
  connectionProvider,
  getResolvedProviderLabel,
  connectionAccountConnected,
  connectionDevicePending,
  connectionNeedsCredentials,
  connectionNeedsBaseUrl,
  connectionHasFreshTest,
  onClose,
  onUpdateConnectionDraft,
  onModelChange,
  onTest,
  onSave,
  onStartAccountLogin,
  onRefreshModels,
  onDisconnect,
  t,
}) => {
  const [expandedModelId, setExpandedModelId] = useState<string | null>(null);
  const [modelCount, setModelCount] = useState(0);
  const provider = connectionProvider;
  const authMode = provider.authMode;
  const busy = connectionDraft.busy !== 'idle';
  const savedConnected = provider.isConfigured && provider.status === 'verified'
    && !hasProviderConnectionDefinitionChanged(provider, connectionDraft);
  const phase = connectionPhase(connectionDraft, connectionHasFreshTest, savedConnected);
  const unavailableCount = connectionDraft.models.filter((model) => model.availability === 'unavailable').length;
  const showDiscoveryEmpty = (authMode === 'environment' || authMode === 'local') && connectionDraft.models.length === 0;
  // Who the connection is (account · plan); otherwise what kind of service it is, never its internal id.
  const subtitle = [provider.accountLabel, provider.planLabel].filter(Boolean).join(' · ')
    || t(getProviderCategoryTranslation(provider.category).label);
  const protocolLabel = getProviderProtocolLabel(provider.protocol);
  const routeCount = provider.routeCount ?? 1;

  return (
    <section className="settings-provider-detail" data-testid="settings-provider-detail" aria-busy={busy}
      aria-label={getResolvedProviderLabel(provider)}>
      <header className="settings-provider-detail-header">
        <div className="settings-provider-detail-identity">
          <h3 className="settings-provider-detail-title">{getResolvedProviderLabel(provider)}</h3>
          <p className="settings-provider-detail-subtitle" title={subtitle}>{subtitle}</p>
        </div>
        {provider.isConfigured ? (
          <div className="settings-provider-detail-actions">
            <Button variant="secondary" size="sm" data-testid={`settings-provider-test-${provider.id}`}
              disabled={busy} onClick={() => void onRefreshModels(provider)}>
              {t('settings.providers.refreshModels')}
            </Button>
            <Button variant="ghost" size="sm" data-testid={`settings-provider-disconnect-${provider.id}`}
              disabled={busy} onClick={() => void onDisconnect(provider)}>
              {authMode === 'account' ? t('settings.signOut') : t('settings.disconnect')}
            </Button>
          </div>
        ) : null}
      </header>

      <div className="settings-provider-connect-body" data-model-count={modelCount} data-testid="settings-provider-connect-body">
        <ProviderAuthModeField
          provider={provider}
          value={connectionDraft.authMode}
          disabled={busy || connectionDevicePending}
          onChange={(nextAuthMode) => onUpdateConnectionDraft({
            authMode: nextAuthMode,
            usingStoredSecret: nextAuthMode === 'api-key' && provider.hasStoredSecretByAuthMode?.['api-key'] === true,
            accountStatus: undefined,
            authCode: '',
            error: '',
            discoveryDiagnostic: null,
            testedApiKey: '',
            testedBaseUrl: '',
            testedProtocol: connectionDraft.protocol,
            testedAuthMode: nextAuthMode,
            testedConnectionSignature: '',
            models: [],
          })}
          t={t}
        />

        {authMode === 'api-key' && (
          <ProviderConnectionFields
            connectionDraft={connectionDraft}
            connectionProvider={provider}
            onUpdateConnectionDraft={onUpdateConnectionDraft}
            t={t}
          />
        )}

        {authMode === 'local' && provider.baseUrlEditable && (
          <SettingsField label={t('settings.providerBaseUrl')} description={t('settings.localProviderConnectHint')}>
            <Input
              data-testid="settings-provider-connect-base-url"
              value={connectionDraft.baseUrl}
              placeholder="http://localhost:11434"
              spellCheck={false}
              onChange={(event) => onUpdateConnectionDraft({
                baseUrl: event.target.value,
                error: '',
                discoveryDiagnostic: null,
                testedApiKey: '',
                testedBaseUrl: '',
                models: [],
              })}
            />
          </SettingsField>
        )}

        {authMode === 'environment' && (
          <SettingsField label={t('settings.providers.authSource')} description={t('settings.environmentProviderConnectHint')}>
            <div className="settings-provider-readonly" data-testid="settings-provider-environment-notice">
              <Icon name="lock" size={14} />
              {t('settings.providers.authSourceEnvironment')}
            </div>
          </SettingsField>
        )}

        <SettingsField label={t('settings.providers.connectionStatus')}>
          <ProviderConnectionStatusLine phase={phase} t={t} />
        </SettingsField>

        {authMode === 'account' && (
          <ProviderAccountOAuthPanel
            connectionDraft={connectionDraft}
            connectionProvider={provider}
            connectionAccountConnected={connectionAccountConnected}
            connectionDevicePending={connectionDevicePending}
            onUpdateConnectionDraft={onUpdateConnectionDraft}
            onStartAccountLogin={onStartAccountLogin}
            t={t}
          />
        )}

        {provider.docsUrl && (
          <a className="settings-link" href={provider.docsUrl} target="_blank" rel="noreferrer">
            {shouldUseProviderDocsLink(provider) ? t('settings.providerDocs') : t('settings.getApiKey')}
          </a>
        )}

        {connectionDraft.error && (
          <InlineError data-testid="settings-provider-connect-error">{connectionDraft.error}</InlineError>
        )}

        {!connectionDraft.error && connectionDraft.discoveryDiagnostic && (
          <p className="settings-provider-notice" data-testid="settings-provider-connect-discovery-diagnostic">
            {t(
              connectionDraft.discoveryDiagnostic.status === 'no-supported-models'
                ? 'settings.providerDiscoveryNoSupportedModels'
                : 'settings.providerDiscoveryMatched',
              connectionDraft.discoveryDiagnostic,
            )}
          </p>
        )}

        {showDiscoveryEmpty ? (
          <section className="settings-provider-discovery" data-testid="settings-provider-discovery">
            <div className="settings-provider-discovery-head">
              <strong>{authMode === 'local' ? t('settings.localProviderModelsTitle') : t('settings.providers.discoveryTitle')}</strong>
              <span className="settings-help-text">{t('settings.localProviderModelsHint')}</span>
            </div>
            <ProviderDiscoveryEmpty t={t} />
          </section>
        ) : null}

        {authMode === 'local' && unavailableCount > 0 ? (
          <p className="settings-provider-notice settings-provider-notice--warning" data-testid="settings-provider-unavailable-summary">
            <Icon name="warning" size={14} />
            {t('settings.localProviderUnavailableSummary', { count: unavailableCount })}
          </p>
        ) : null}

        {showDiscoveryEmpty || (authMode === 'account' && !connectionAccountConnected) ? null : (
          <ProviderConnectModelList
            provider={provider}
            models={connectionDraft.models}
            discoveryAccountId={connectionHasFreshTest ? connectionDraft.discoveryAccountId : null}
            expandedModelId={expandedModelId}
            disabled={busy}
            onToggleExpanded={(modelId) => setExpandedModelId((current) => (current === modelId ? null : modelId))}
            onModelChange={onModelChange}
            onModelCountChange={setModelCount}
            t={t}
          />
        )}

        <Details className="settings-provider-summary" data-testid="settings-provider-summary" summary={t('settings.providers.diagnostics')}>
          <dl className="settings-provider-diagnostics">
            <div><dt>{t('settings.providers.serviceId')}</dt><dd>{provider.id}</dd></div>
            <div>
              <dt>{t('settings.providerProtocol')}</dt>
              <dd>{routeCount > 1 ? t('settings.providerProtocolMulti', { protocol: protocolLabel, count: routeCount }) : protocolLabel}</dd>
            </div>
          </dl>
          {authMode !== 'account' ? <ProviderProtocolSummary provider={provider} t={t} /> : null}
          <ProviderProbeBatchPanel providerIds={[provider.id]} disabled={busy || !provider.isConfigured} t={t} />
        </Details>
      </div>

      <footer className="settings-provider-detail-footer">
        <ProviderConnectActions
          draft={connectionDraft}
          provider={provider}
          accountConnected={connectionAccountConnected}
          devicePending={connectionDevicePending}
          needsCredentials={connectionNeedsCredentials}
          needsBaseUrl={connectionNeedsBaseUrl}
          hasFreshTest={connectionHasFreshTest}
          onClose={onClose}
          onTest={onTest}
          onSave={onSave}
          t={t}
        />
      </footer>
    </section>
  );
};
