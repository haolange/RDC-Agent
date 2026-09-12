import React, { useState } from 'react';
import type { LlmProviderEntry, LlmProviderModel } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { Icon } from '../../../../ui/Icon';
import { InlineError } from '../../../../ui/InlineError';
import { Input } from '../../../../ui/Input';
import { TaskDialog } from '../../../../ui/TaskDialog';
import type { ProviderConnectionDraft } from '../types';
import { getProviderCategoryTranslation } from '../utils';
import { ProviderAccountOAuthPanel } from './ProviderAccountOAuthPanel';
import { ProviderConnectionFields } from './ProviderConnectionFields';
import { ProviderAuthModeField } from './ProviderAuthModeField';
import { ProviderConnectModelList } from './ProviderConnectModelList';
import { ProviderConnectActions } from './ProviderConnectActions';
import { ProviderConnectionStatusLine, ProviderDiscoveryEmpty, ProviderProtocolSummary, connectionPhase } from './ProviderConnectSummary';
import { SettingsField } from '../parts';
import { shouldUseProviderDocsLink } from '../providerConnectionState';

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
  onStartAccountLogin: (mode?: ProviderConnectionDraft['accountLoginMode']) => void | Promise<void>;
  t: Translate;
}

export const ProviderConnectDialog: React.FC<ProviderConnectDialogProps> = ({
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
  t,
}) => {
  const [expandedModelId, setExpandedModelId] = useState<string | null>(null);
  const [modelCount, setModelCount] = useState(0);
  const authMode = connectionProvider.authMode;
  const phase = connectionPhase(connectionDraft, connectionHasFreshTest);
  const unavailableCount = connectionDraft.models.filter((model) => model.availability === 'unavailable').length;
  const showDiscoveryEmpty = (authMode === 'environment' || authMode === 'local') && connectionDraft.models.length === 0;

  return (
    <TaskDialog
      open
      size="lg"
      className="settings-provider-connect-dialog"
      title={getResolvedProviderLabel(connectionProvider)}
      description={t(getProviderCategoryTranslation(connectionProvider.category).label)}
      onClose={onClose}
      closeLabel={t('settings.cancel')}
      busy={connectionDraft.busy !== 'idle'}
      dataTestId="settings-provider-connect-dialog"
      footer={(
        <ProviderConnectActions
          draft={connectionDraft}
          provider={connectionProvider}
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
      <div
        className="settings-provider-connect-body"
        data-model-count={modelCount}
        data-testid="settings-provider-connect-body"
      >
        <ProviderAuthModeField
          provider={connectionProvider}
          value={connectionDraft.authMode}
          disabled={connectionDraft.busy !== 'idle' || connectionDevicePending}
          onChange={(nextAuthMode) => onUpdateConnectionDraft({
            authMode: nextAuthMode,
            usingStoredSecret: nextAuthMode === 'api-key'
              && connectionProvider.hasStoredSecretByAuthMode?.['api-key'] === true,
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
            connectionProvider={connectionProvider}
            onUpdateConnectionDraft={onUpdateConnectionDraft}
            t={t}
          />
        )}

        {authMode === 'local' && connectionProvider.baseUrlEditable && (
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
          <>
            <SettingsField label={t('settings.providers.authSource')} description={t('settings.environmentProviderConnectHint')}>
              <div className="settings-provider-readonly" data-testid="settings-provider-environment-notice">
                <Icon name="lock" size={14} />
                {t('settings.providers.authSourceEnvironment')}
              </div>
            </SettingsField>
          </>
        )}

        <SettingsField label={t('settings.providers.connectionStatus')}>
          <ProviderConnectionStatusLine phase={phase} t={t} />
        </SettingsField>

        {authMode !== 'account' && (
          <details className="settings-provider-summary" data-testid="settings-provider-summary">
            <summary>{t('settings.providers.summary.title')}</summary>
            <ProviderProtocolSummary provider={connectionProvider} t={t} />
          </details>
        )}

        {authMode === 'account' && (
          <ProviderAccountOAuthPanel
            connectionDraft={connectionDraft}
            connectionProvider={connectionProvider}
            connectionAccountConnected={connectionAccountConnected}
            connectionDevicePending={connectionDevicePending}
            onUpdateConnectionDraft={onUpdateConnectionDraft}
            onStartAccountLogin={onStartAccountLogin}
            t={t}
          />
        )}

        {connectionProvider.docsUrl && (
          <a className="settings-link" href={connectionProvider.docsUrl} target="_blank" rel="noreferrer">
            {shouldUseProviderDocsLink(connectionProvider)
              ? t('settings.providerDocs')
              : t('settings.getApiKey')}
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
          provider={connectionProvider}
          models={connectionDraft.models}
          discoveryAccountId={connectionHasFreshTest ? connectionDraft.discoveryAccountId : null}
          expandedModelId={expandedModelId}
          disabled={connectionDraft.busy !== 'idle'}
          onToggleExpanded={(modelId) => setExpandedModelId((current) => (current === modelId ? null : modelId))}
          onModelChange={onModelChange}
          onModelCountChange={setModelCount}
          t={t}
        />
        )}
      </div>
    </TaskDialog>
  );
};
