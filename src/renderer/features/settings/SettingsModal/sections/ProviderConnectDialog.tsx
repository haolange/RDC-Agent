import React, { useState } from 'react';
import { CopyDiagnosticsButton } from '../../../../patterns/CopyDiagnostics';
import { Icon } from '../../../../ui/Icon';
import { InlineError } from '../../../../ui/InlineError';
import { Input } from '../../../../ui/Input';
import { TaskDialog } from '../../../../ui/TaskDialog';
import { SettingsField } from '../parts';
import { shouldUseProviderDocsLink } from '../providerConnectionState';
import { hasProviderConnectionDefinitionChanged } from '../providerConnectionRequest';
import { getProviderCategoryTranslation, getProviderProtocolLabel } from '../utils';
import { ProviderAccountOAuthPanel } from './ProviderAccountOAuthPanel';
import { ProviderAuthModeField } from './ProviderAuthModeField';
import { ProviderConnectActions } from './ProviderConnectActions';
import { ProviderConnectionFields } from './ProviderConnectionFields';
import { ProviderConnectionStatusLine, ProviderDiscoveryEmpty, connectionPhase } from './ProviderConnectSummary';
import { ProviderConnectModelList } from './ProviderConnectModelList';
import { ProviderProbeBatchPanel } from './ProviderProbeBatchPanel';
import type { ProviderConnectionDraft } from '../types';
import type { LlmProviderEntry, LlmProviderModel } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];

interface ProviderConnectDialogProps {
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
  t: Translate;
}

/**
 * One service's panel, opened from its card: how it connects and whether it is connected, then its models as
 * a table, then a capability check. Its technical identity leaves only through the copy action by its status.
 */
export const ProviderConnectDialog: React.FC<ProviderConnectDialogProps> = ({
  connectionDraft,
  connectionProvider: provider,
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
  t,
}) => {
  const [expandedModelId, setExpandedModelId] = useState<string | null>(null);
  const [modelCount, setModelCount] = useState(0);
  const authMode = provider.authMode;
  const busy = connectionDraft.busy !== 'idle';
  const savedConnected = provider.isConfigured && provider.status === 'verified'
    && !hasProviderConnectionDefinitionChanged(provider, connectionDraft);
  const phase = connectionPhase(connectionDraft, connectionHasFreshTest, savedConnected);
  const unavailableCount = connectionDraft.models.filter((model) => model.availability === 'unavailable').length;
  const showDiscoveryEmpty = (authMode === 'environment' || authMode === 'local') && connectionDraft.models.length === 0;
  // Who the connection is (account · plan); otherwise what kind of service it is.
  const subtitle = [provider.accountLabel, provider.planLabel].filter(Boolean).join(' · ')
    || t(getProviderCategoryTranslation(provider.category).label);
  const protocolLabel = getProviderProtocolLabel(provider.protocol);
  const routeCount = provider.routeCount ?? 1;

  return (
    <TaskDialog
      open
      size="lg"
      className="settings-provider-connect-dialog"
      title={getResolvedProviderLabel(provider)}
      description={subtitle}
      onClose={onClose}
      closeLabel={t('settings.cancel')}
      busy={busy}
      dataTestId="settings-provider-connect-dialog"
      footer={(
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
      )}
    >
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
          <div className="settings-provider-connection-row">
            <ProviderConnectionStatusLine phase={phase} t={t} />
            {/* The service's technical identity leaves through one copy action beside its status. */}
            <CopyDiagnosticsButton testId="settings-provider-diagnostics" facts={[
              { label: t('settings.providers.serviceId'), value: provider.id },
              { label: t('settings.providerProtocol'),
                value: routeCount > 1 ? t('settings.providerProtocolMulti', { protocol: protocolLabel, count: routeCount }) : protocolLabel },
              { label: t('settings.providerBaseUrl'), value: connectionDraft.baseUrl || provider.baseUrl },
            ]} />
          </div>
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
          <InlineError data-testid="settings-provider-connect-error" detail={connectionDraft.error}>{t('settings.providerTestFailed')}</InlineError>
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
              <p className="settings-section-description">{t('settings.localProviderModelsHint')}</p>
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

        <ProviderProbeBatchPanel providerIds={[provider.id]} disabled={busy || !provider.isConfigured} t={t} />
      </div>
    </TaskDialog>
  );
};
