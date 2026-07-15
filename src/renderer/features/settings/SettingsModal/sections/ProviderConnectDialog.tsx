import React, { useState } from 'react';
import type { LlmProviderEntry, LlmProviderModel } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import type { ProviderConnectionDraft } from '../types';
import { getProviderCategoryTranslation } from '../utils';
import { ProviderAccountOAuthPanel } from './ProviderAccountOAuthPanel';
import { ProviderConnectionFields } from './ProviderConnectionFields';
import { ProviderAuthModeField } from './ProviderAuthModeField';
import { ProviderConnectModelList } from './ProviderConnectModelList';
import { ProviderConnectActions } from './ProviderConnectActions';
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
  const [effectiveModelCount, setEffectiveModelCount] = useState(0);
  const catalogModelCount = Math.max(
    effectiveModelCount,
    connectionDraft.models.length,
    connectionProvider.models?.length ?? 0,
    connectionProvider.recommendedModels?.length ?? 0,
  );
  const modelListSize = catalogModelCount >= 24 ? 'long' : catalogModelCount >= 8 ? 'medium' : 'short';

  const handleToggleModelCapability = (modelId: string) => {
    setExpandedModelId((current) => (current === modelId ? null : modelId));
  };
  return (
  <div
    className="settings-provider-connect-layer"
    data-testid="settings-provider-connect-layer"
    onClick={(event) => {
      event.stopPropagation();
      onClose();
    }}
  >
    <div
      className="settings-provider-connect-dialog"
      data-model-list-size={modelListSize}
      data-testid="settings-provider-connect-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-provider-connect-title"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="settings-provider-connect-header">
        <div>
          <div className="settings-provider-connect-kicker">{t(getProviderCategoryTranslation(connectionProvider.category).label)}</div>
          <div className="settings-provider-connect-title" id="settings-provider-connect-title">
            {getResolvedProviderLabel(connectionProvider)}
          </div>
        </div>
        <button type="button"
          className="settings-modal-close"
          onClick={onClose}
          aria-label={t('settings.close')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <ProviderAuthModeField
        provider={connectionProvider}
        value={connectionDraft.authMode}
        disabled={connectionDraft.busy !== 'idle' || connectionDevicePending}
        onChange={(authMode) => onUpdateConnectionDraft({
          authMode,
          usingStoredSecret: authMode === 'api-key'
            && connectionProvider.hasStoredSecretByAuthMode?.['api-key'] === true,
          accountStatus: undefined,
          authCode: '',
          error: '',
          discoveryDiagnostic: null,
          testedApiKey: '',
          testedBaseUrl: '',
          testedProtocol: connectionDraft.protocol,
          testedAuthMode: authMode,
          testedConnectionSignature: '',
          models: [],
        })}
        t={t}
      />

      {connectionProvider.authMode === 'api-key' && (
        <ProviderConnectionFields
          connectionDraft={connectionDraft}
          connectionProvider={connectionProvider}
          onUpdateConnectionDraft={onUpdateConnectionDraft}
          t={t}
        />
      )}
      {connectionProvider.authMode === 'local' && connectionProvider.baseUrlEditable && (
        <label className="settings-field">
          <span className="settings-field-label">{t('settings.providerBaseUrl')}</span>
          <input
            className="input"
            data-testid="settings-provider-connect-base-url"
            value={connectionDraft.baseUrl}
            onChange={(event) => onUpdateConnectionDraft({
              baseUrl: event.target.value,
              error: '',
              discoveryDiagnostic: null,
              testedApiKey: '',
              testedBaseUrl: '',
              models: [],
            })}
          />
        </label>
      )}
      {connectionProvider.authMode === 'local' && (
        <div className="settings-provider-notice">
          {t('settings.localProviderConnectHint')}
        </div>
      )}

      {connectionProvider.authMode === 'environment' && (
        <div className="settings-provider-notice" data-testid="settings-provider-environment-notice">
          {t('settings.environmentProviderConnectHint')}
        </div>
      )}

      {connectionProvider.authMode === 'account' && (
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
        <div className="settings-provider-notice error" data-testid="settings-provider-connect-error">
          {connectionDraft.error}
        </div>
      )}

      {!connectionDraft.error && connectionDraft.discoveryDiagnostic && (
        <div className="settings-provider-notice" data-testid="settings-provider-connect-discovery-diagnostic">
          {t(
            connectionDraft.discoveryDiagnostic.status === 'no-supported-models'
              ? 'settings.providerDiscoveryNoSupportedModels'
              : 'settings.providerDiscoveryMatched',
            connectionDraft.discoveryDiagnostic,
          )}
        </div>
      )}

      <ProviderConnectModelList
        provider={connectionProvider}
        models={connectionDraft.models}
        expandedModelId={expandedModelId}
        disabled={connectionDraft.busy !== 'idle'}
        onToggleExpanded={handleToggleModelCapability}
        onModelChange={onModelChange}
        onModelCountChange={setEffectiveModelCount}
        t={t}
      />

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
    </div>
  </div>
  );
};
