import React, { useState } from 'react';
import type { LlmProviderEntry } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import type { ProviderCatalogCategory, ProviderConnectionDraft } from '../types';
import {
  getProviderCategoryLabel,
  getProviderProtocolOptions,
  providerSupportsProtocolSelection,
} from '../utils';
import { ProviderAccountOAuthPanel } from './ProviderAccountOAuthPanel';
import { ProviderApiKeyFields } from './ProviderApiKeyFields';
import { ProviderConnectModelRow } from './ProviderConnectModelRow';
import { ProviderProtocolField } from './ProviderProtocolField';

type Translate = ReturnType<typeof useI18n>['t'];

interface ProviderConnectDialogProps {
  connectionDraft: ProviderConnectionDraft;
  connectionProvider: LlmProviderEntry;
  getResolvedProviderLabel: (provider: Pick<LlmProviderEntry, 'label'>) => string;
  providerCatalogCategories: ProviderCatalogCategory[];
  connectionAccountConnected: boolean;
  connectionDevicePending: boolean;
  connectionNeedsApiKey: boolean;
  connectionNeedsBaseUrl: boolean;
  connectionHasFreshTest: boolean;
  onClose: () => void;
  onUpdateConnectionDraft: (patch: Partial<ProviderConnectionDraft>) => void;
  onTest: () => void | Promise<void>;
  onSave: () => void | Promise<void>;
  onStartAccountLogin: (accountLoginMode?: ProviderConnectionDraft['accountLoginMode']) => void | Promise<void>;
  t: Translate;
}

export const ProviderConnectDialog: React.FC<ProviderConnectDialogProps> = ({
  connectionDraft,
  connectionProvider,
  getResolvedProviderLabel,
  providerCatalogCategories,
  connectionAccountConnected,
  connectionDevicePending,
  connectionNeedsApiKey,
  connectionNeedsBaseUrl,
  connectionHasFreshTest,
  onClose,
  onUpdateConnectionDraft,
  onTest,
  onSave,
  onStartAccountLogin,
  t,
}) => {
  const accountRequiresCode = Boolean(
    connectionProvider.authMode === 'account'
    && connectionDraft.accountStatus?.requiresCodeInput,
  );
  const accountSaveBlocked = Boolean(
    connectionProvider.authMode === 'account'
    && !connectionAccountConnected
    && (!accountRequiresCode || !connectionDraft.authCode.trim()),
  );
  const accountTestBlocked = Boolean(
    connectionProvider.authMode === 'account'
    && !connectionAccountConnected,
  );
  const commonActionBlocked = connectionDraft.busy !== 'idle'
    || connectionNeedsApiKey
    || connectionNeedsBaseUrl
    || connectionDevicePending;
  const [expandedModelId, setExpandedModelId] = useState<string | null>(null);
  const modelListSize = connectionDraft.models.length >= 24 ? 'long' : connectionDraft.models.length >= 8 ? 'medium' : 'short';
  const showProtocolField = connectionProvider.authMode !== 'account';
  const showProtocolSelector = showProtocolField && providerSupportsProtocolSelection(connectionProvider);
  const protocolOptions = showProtocolField ? getProviderProtocolOptions(connectionProvider) : [];

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
          <div className="settings-provider-connect-kicker">{getProviderCategoryLabel(connectionProvider, providerCatalogCategories)}</div>
          <div className="settings-provider-connect-title" id="settings-provider-connect-title">
            {getResolvedProviderLabel(connectionProvider)}
          </div>
        </div>
        <button
          type="button"
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

      {showProtocolField && (
        <ProviderProtocolField
          value={connectionDraft.protocol}
          options={protocolOptions}
          disabled={connectionDraft.busy !== 'idle'}
          readOnly={!showProtocolSelector}
          onChange={(protocol) => onUpdateConnectionDraft({
            protocol,
            error: '',
            testedApiKey: '',
            testedBaseUrl: '',
            testedProtocol: protocol,
            models: [],
          })}
          t={t}
        />
      )}

      {connectionProvider.authMode === 'api-key' && (
        <ProviderApiKeyFields
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
          {connectionProvider.authMode === 'local' || connectionProvider.authMode === 'account' || connectionProvider.authMode === 'environment' ? t('settings.providerDocs') : t('settings.getApiKey')}
        </a>
      )}

      {connectionDraft.error && (
        <div className="settings-provider-notice error" data-testid="settings-provider-connect-error">
          {connectionDraft.error}
        </div>
      )}

      <div className="settings-model-section settings-provider-connect-models" data-testid="settings-provider-connect-models">
        <div className="settings-model-section-header">
          <span>{connectionProvider.catalogOwnership === 'app-managed'
            ? t('settings.providers.capability.appManagedModels')
            : t('settings.providers.capability.userManagedModels')}</span>
          <span className="settings-help-text">
            {t('settings.providerModelCount', { count: connectionDraft.models.length })}
          </span>
        </div>
        {connectionProvider.catalogOwnership === 'user-managed' ? (
          <div className="settings-provider-notice" data-testid="settings-provider-user-managed-models">
            {t('settings.providers.capability.userManagedProviderHint')}
          </div>
        ) : (
          <div className="settings-provider-notice" data-testid="settings-provider-app-managed-models">
            {t('settings.providers.capability.appManagedProviderHint')}
          </div>
        )}
        <div className="settings-model-list" data-empty-label={t('settings.testBeforeSaveHint')}>
          {connectionDraft.models.map((model) => (
            <ProviderConnectModelRow
              key={model.id}
              provider={connectionProvider}
              model={model}
              expanded={expandedModelId === model.id}
              disabled={connectionDraft.busy !== 'idle'}
              onToggleExpanded={handleToggleModelCapability}
              t={t}
            />
          ))}
        </div>
      </div>

      <div className="settings-actions settings-provider-connect-actions">
        <button type="button" className="button button-secondary" onClick={onClose}>
          {t('settings.cancel')}
        </button>
        <button
          type="button"
          className="button button-secondary"
          data-testid="settings-provider-connect-test"
          onClick={() => void onTest()}
          disabled={commonActionBlocked || accountTestBlocked}
        >
          {connectionDraft.busy === 'testing' ? t('settings.testing') : t('settings.test')}
        </button>
        <button
          type="button"
          className="button button-primary"
          data-testid="settings-provider-connect-save"
          onClick={() => void onSave()}
          disabled={commonActionBlocked || accountSaveBlocked}
        >
          {connectionDraft.busy === 'saving'
            ? t('settings.saving')
            : connectionProvider.authMode === 'account'
              ? connectionProvider.isConfigured
                ? t('settings.save')
                : t('settings.connect')
              : connectionHasFreshTest
                ? t('settings.save')
                : t('settings.connect')}
        </button>
      </div>
    </div>
  </div>
  );
};
