import React, { useState } from 'react';
import { CopyDiagnosticsMenu } from '../../../../patterns/CopyDiagnostics';
import { Icon } from '../../../../ui/Icon';
import { InlineError } from '../../../../ui/InlineError';
import { Input } from '../../../../ui/Input';
import { TaskDialog } from '../../../../ui/TaskDialog';
import { SettingsField } from '../parts';
import { shouldUseProviderDocsLink } from '../providerConnectionState';
import { hasProviderConnectionDefinitionChanged } from '../providerConnectionRequest';
import { getProviderProtocolLabel } from '../utils';
import { useI18n } from '../../../../i18n';
import { ProviderAccountOAuthPanel } from './ProviderAccountOAuthPanel';
import { ProviderAuthModeField } from './ProviderAuthModeField';
import { ProviderMark } from './ProviderMark';
import { providerIdentityDetail } from './providerCardModel';
import { ProviderConnectActions } from './ProviderConnectActions';
import { ProviderConnectionFields } from './ProviderConnectionFields';
import { ProviderConnectionStatusLine, ProviderDiscoveryEmpty, connectionPhase } from './ProviderConnectSummary';
import { ProviderConnectModelList } from './ProviderConnectModelList';
import { ProviderProbeBatchPanel } from './ProviderProbeBatchPanel';
import type { ProviderConnectionDraft } from '../types';
import type { LlmProviderEntry, LlmProviderModel } from '@shared/types/settings';

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
}

/**
 * One service's panel, opened from its card: how it connects and whether it is connected, then its models as
 * a table, then a capability check. The footer tracks the connection result while the user edits.
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
}) => {
  const { t } = useI18n();
  const [expandedModelId, setExpandedModelId] = useState<string | null>(null);
  const [modelCount, setModelCount] = useState(0);
  const authMode = provider.authMode;
  const busy = connectionDraft.busy !== 'idle';
  const savedConnected =
    provider.isConfigured &&
    provider.status === 'verified' &&
    !hasProviderConnectionDefinitionChanged(provider, connectionDraft);
  const phase = connectionPhase(connectionDraft, connectionHasFreshTest, savedConnected);
  const unavailableCount = connectionDraft.models.filter((model) => model.availability === 'unavailable').length;
  const showDiscoveryEmpty =
    (authMode === 'environment' || authMode === 'local') && connectionDraft.models.length === 0;
  const title = getResolvedProviderLabel(provider);
  const protocolLabel = getProviderProtocolLabel(provider.protocol);
  const routeCount = provider.routeCount ?? 1;
  const account = authMode === 'account' ? connectionDraft.accountStatus : undefined;

  return (
    <TaskDialog
      open
      size="lg"
      className="settings-provider-connect-dialog"
      title={title}
      titleIcon={<ProviderMark id={provider.id} category={provider.category} />}
      headerActions={
        <>
          {provider.isConfigured ? <ProviderProbeBatchPanel providerIds={[provider.id]} disabled={busy} /> : null}
          <CopyDiagnosticsMenu
            testId="settings-provider-diagnostics"
            label={t('settings.directory.more', { name: title })}
            facts={[
              { label: t('settings.providers.serviceId'), value: provider.id },
              {
                label: t('settings.providerProtocol'),
                value:
                  routeCount > 1
                    ? t('settings.providerProtocolMulti', { protocol: protocolLabel, count: routeCount })
                    : protocolLabel,
              },
              { label: t('settings.providerBaseUrl'), value: connectionDraft.baseUrl || provider.baseUrl },
              { label: t('settings.oauthRedirectUri'), value: account?.redirectUri },
              {
                label: t('settings.oauthRequestedScopes'),
                value: account?.requestedScopes ?? account?.diagnostic?.requestedScopes,
              },
              { label: t('settings.oauthProviderErrorLabel'), value: account?.diagnostic?.providerError },
              { label: t('settings.oauthDiagnosticDetail'), value: account?.diagnostic?.detail },
            ]}
          />
        </>
      }
      description={
        provider.accountLabel || provider.planLabel || provider.category === 'coding-token-plan'
          ? providerIdentityDetail(provider, title, t)
          : undefined
      }
      onClose={onClose}
      closeLabel={t('settings.cancel')}
      busy={busy}
      dataTestId="settings-provider-connect-dialog"
      footer={
        <>
          {connectionDraft.modelSaveError ? (
            <InlineError className="settings-provider-connection-status" detail={connectionDraft.modelSaveError}>
              {t('settings.providerSaveFailed')}
            </InlineError>
          ) : (
            <ProviderConnectionStatusLine phase={phase} />
          )}
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
          />
        </>
      }
    >
      <div
        className="settings-provider-connect-body"
        data-model-count={modelCount}
        data-testid="settings-provider-connect-body"
      >
        <ProviderAuthModeField
          provider={provider}
          value={connectionDraft.authMode}
          disabled={busy || connectionDevicePending}
          onChange={(nextAuthMode) =>
            onUpdateConnectionDraft({
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
            })
          }
        />

        {authMode === 'api-key' && (
          <ProviderConnectionFields
            connectionDraft={connectionDraft}
            connectionProvider={provider}
            onUpdateConnectionDraft={onUpdateConnectionDraft}
          />
        )}

        {authMode === 'local' && provider.baseUrlEditable && (
          <SettingsField label={t('settings.providerBaseUrl')} description={t('settings.localProviderConnectHint')}>
            <Input
              data-testid="settings-provider-connect-base-url"
              value={connectionDraft.baseUrl}
              placeholder="http://localhost:11434"
              spellCheck={false}
              onChange={(event) =>
                onUpdateConnectionDraft({
                  baseUrl: event.target.value,
                  error: '',
                  discoveryDiagnostic: null,
                  testedApiKey: '',
                  testedBaseUrl: '',
                  models: [],
                })
              }
            />
          </SettingsField>
        )}

        {authMode === 'environment' && (
          <SettingsField
            label={t('settings.providers.authSource')}
            description={t('settings.environmentProviderConnectHint')}
          >
            <div className="settings-provider-readonly" data-testid="settings-provider-environment-notice">
              <Icon name="lock" size={14} />
              {t('settings.providers.authSourceEnvironment')}
            </div>
          </SettingsField>
        )}

        {authMode === 'account' && (
          <ProviderAccountOAuthPanel
            connectionDraft={connectionDraft}
            connectionProvider={provider}
            connectionAccountConnected={connectionAccountConnected}
            connectionDevicePending={connectionDevicePending}
            onUpdateConnectionDraft={onUpdateConnectionDraft}
            onStartAccountLogin={onStartAccountLogin}
          />
        )}

        {provider.docsUrl && (
          <a className="settings-link" href={provider.docsUrl} target="_blank" rel="noreferrer">
            {shouldUseProviderDocsLink(provider) ? t('settings.providerDocs') : t('settings.getApiKey')}
          </a>
        )}

        {connectionDraft.error && (
          <InlineError data-testid="settings-provider-connect-error" detail={connectionDraft.error}>
            {t('settings.providerTestFailed')}
          </InlineError>
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
              <strong>
                {authMode === 'local' ? t('settings.localProviderModelsTitle') : t('settings.providers.discoveryTitle')}
              </strong>
              <p className="settings-section-description">{t('settings.localProviderModelsHint')}</p>
            </div>
            <ProviderDiscoveryEmpty />
          </section>
        ) : null}

        {authMode === 'local' && unavailableCount > 0 ? (
          <p
            className="settings-provider-notice settings-provider-notice--warning"
            data-testid="settings-provider-unavailable-summary"
          >
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
          />
        )}
      </div>
    </TaskDialog>
  );
};
