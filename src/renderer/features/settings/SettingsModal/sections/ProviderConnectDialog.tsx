import React from 'react';
import type { LlmProviderEntry } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import type { ProviderConnectionDraft } from '../types';
import { getProviderGroupLabel, STORED_SECRET_MASK } from '../utils';

type Translate = ReturnType<typeof useI18n>['t'];

interface ProviderConnectDialogProps {
  connectionDraft: ProviderConnectionDraft;
  connectionProvider: LlmProviderEntry;
  getResolvedProviderLabel: (provider: Pick<LlmProviderEntry, 'label'>) => string;
  connectionAccountConnected: boolean;
  connectionDevicePending: boolean;
  connectionNeedsApiKey: boolean;
  connectionNeedsBaseUrl: boolean;
  connectionHasFreshTest: boolean;
  onClose: () => void;
  onUpdateConnectionDraft: (patch: Partial<ProviderConnectionDraft>) => void;
  onTest: () => void | Promise<void>;
  onSave: () => void | Promise<void>;
  onStartAccountLogin: () => void | Promise<void>;
  t: Translate;
}

export const ProviderConnectDialog: React.FC<ProviderConnectDialogProps> = ({
  connectionDraft,
  connectionProvider,
  getResolvedProviderLabel,
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
}) => (
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
      data-testid="settings-provider-connect-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-provider-connect-title"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="settings-provider-connect-header">
        <div>
          <div className="settings-provider-connect-kicker">{getProviderGroupLabel(connectionProvider)}</div>
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

      {connectionProvider.authMode === 'api-key' && (
        <>
          {connectionProvider.baseUrlEditable && (
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
                  models: [],
                })}
              />
            </label>
          )}
          <label className="settings-field">
            <span className="settings-field-label">{t('settings.apiKey')}</span>
            <div className="settings-secret-field">
              <input
                className="input settings-secret-input"
                data-testid="settings-provider-connect-api-key"
                type={connectionDraft.showApiKey && !connectionDraft.usingStoredSecret ? 'text' : 'password'}
                value={connectionDraft.usingStoredSecret ? STORED_SECRET_MASK : connectionDraft.apiKey}
                placeholder=""
                onFocus={() => {
                  if (connectionDraft.usingStoredSecret) {
                    onUpdateConnectionDraft({ usingStoredSecret: false, apiKey: '', showApiKey: false });
                  }
                }}
                onChange={(event) => onUpdateConnectionDraft({
                  apiKey: event.target.value,
                  usingStoredSecret: false,
                  error: '',
                  testedApiKey: '',
                  models: [],
                })}
              />
              <button
                type="button"
                className="settings-secret-toggle"
                data-testid="settings-provider-connect-api-key-toggle"
                onClick={() => {
                  if (connectionDraft.usingStoredSecret) {
                    onUpdateConnectionDraft({ usingStoredSecret: false, apiKey: '', showApiKey: false });
                    return;
                  }
                  onUpdateConnectionDraft({ showApiKey: !connectionDraft.showApiKey });
                }}
                aria-label={connectionDraft.usingStoredSecret ? t('settings.replaceSecret') : connectionDraft.showApiKey ? t('settings.hideSecret') : t('settings.showSecret')}
                disabled={!connectionDraft.usingStoredSecret && !connectionDraft.apiKey}
              >
                {connectionDraft.usingStoredSecret
                  ? t('settings.replaceSecret')
                  : connectionDraft.showApiKey ? t('settings.hideSecret') : t('settings.showSecret')}
              </button>
            </div>
            <span className="settings-help-text">
              {connectionProvider.hasStoredSecret ? t('settings.apiKeyStoredHint') : t('settings.apiKeyConnectHint')}
            </span>
          </label>
        </>
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
        <div className="settings-provider-oauth-panel">
          <div className="settings-provider-notice">
            {connectionAccountConnected
              ? t('settings.oauthConnectedHint')
              : connectionDevicePending
                ? t('settings.githubAuthorizationPending')
                : connectionDraft.accountStatus?.message || t('settings.oauthConnectHint')}
          </div>
          {connectionAccountConnected && (connectionDraft.accountStatus?.accountLabel || connectionDraft.accountStatus?.planLabel) && (
            <div className="settings-secret-status" data-testid="settings-provider-oauth-summary">
              <span>{[connectionDraft.accountStatus.accountLabel, connectionDraft.accountStatus.planLabel].filter(Boolean).join(' · ')}</span>
            </div>
          )}
          {!connectionAccountConnected && (
            <button
              type="button"
              className="button button-secondary"
              data-testid="settings-provider-oauth-start"
              onClick={() => void onStartAccountLogin()}
              disabled={connectionDraft.busy !== 'idle' || connectionDevicePending}
            >
              {t('settings.connect')}
            </button>
          )}
          {!connectionAccountConnected && connectionDraft.accountStatus?.authUrl && (
            <a className="settings-link" href={connectionDraft.accountStatus.authUrl} target="_blank" rel="noreferrer">
              {t('settings.openAuthPage')}
            </a>
          )}
          {!connectionAccountConnected && connectionDraft.accountStatus?.verificationUri && (
            <div className="settings-secret-status">
              <span>{connectionDraft.accountStatus.verificationUri}</span>
              <strong data-testid="settings-provider-oauth-device-code">
                {connectionDraft.accountStatus.userCode}
              </strong>
            </div>
          )}
          {!connectionAccountConnected && connectionDraft.accountStatus?.requiresCodeInput && (
            <label className="settings-field">
              <span className="settings-field-label">{t('settings.oauthCode')}</span>
              <input
                className="input"
                data-testid="settings-provider-oauth-code"
                value={connectionDraft.authCode}
                onChange={(event) => onUpdateConnectionDraft({ authCode: event.target.value, error: '' })}
              />
            </label>
          )}
        </div>
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
          <span>{connectionProvider.modelDiscovery === 'account-catalog'
            ? t('settings.accountCatalogModels')
            : connectionProvider.modelDiscovery === 'anthropic-candidate-validation' || connectionProvider.modelDiscovery === 'azure-openai'
              ? t('settings.verifiedModels')
              : connectionProvider.modelDiscovery === 'static'
                ? t('settings.builtinModels')
                : t('settings.discoveredModels')}</span>
          <span className="settings-help-text">
            {t('settings.providerModelCount', { count: connectionDraft.models.length })}
          </span>
        </div>
        <div className="settings-model-list" data-empty-label={t('settings.testBeforeSaveHint')}>
          {connectionDraft.models.map((model) => (
            <div key={model.id} className="settings-model-row">
              <span className="settings-model-row-check">OK</span>
              <span className="settings-model-row-label">{model.label}</span>
            </div>
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
          disabled={connectionDraft.busy !== 'idle' || connectionNeedsApiKey || connectionNeedsBaseUrl || connectionDevicePending}
        >
          {connectionDraft.busy === 'testing' ? t('settings.testing') : t('settings.test')}
        </button>
        <button
          type="button"
          className="button button-primary"
          data-testid="settings-provider-connect-save"
          onClick={() => void onSave()}
          disabled={connectionDraft.busy !== 'idle' || connectionNeedsApiKey || connectionNeedsBaseUrl || connectionDevicePending}
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
