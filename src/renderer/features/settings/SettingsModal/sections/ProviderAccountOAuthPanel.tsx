import React from 'react';
import { SUPER_GROK_OAUTH_REDIRECT_URI } from '@shared/constants/llm';
import type { LlmProviderEntry } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import type { ProviderConnectionDraft } from '../types';

type Translate = ReturnType<typeof useI18n>['t'];

interface ProviderAccountOAuthPanelProps {
  connectionDraft: ProviderConnectionDraft;
  connectionProvider: LlmProviderEntry;
  connectionAccountConnected: boolean;
  connectionDevicePending: boolean;
  onUpdateConnectionDraft: (patch: Partial<ProviderConnectionDraft>) => void;
  onStartAccountLogin: (accountLoginMode?: ProviderConnectionDraft['accountLoginMode']) => void | Promise<void>;
  t: Translate;
}

const sourceLabelKey = (source?: string): Parameters<Translate>[0] => {
  if (source === 'manual') return 'settings.oauthClientIdSourceManual';
  if (source === 'env') return 'settings.oauthClientIdSourceEnv';
  if (source === 'stored') return 'settings.oauthClientIdSourceStored';
  return 'settings.oauthClientIdSourceMissing';
};

const copyText = (value?: string) => {
  if (!value) return;
  void navigator.clipboard?.writeText(value);
};

export const ProviderAccountOAuthPanel: React.FC<ProviderAccountOAuthPanelProps> = ({
  connectionDraft,
  connectionProvider,
  connectionAccountConnected,
  connectionDevicePending,
  onUpdateConnectionDraft,
  onStartAccountLogin,
  t,
}) => {
  const status = connectionDraft.accountStatus;
  const isSuperGrok = connectionProvider.id === 'grok-account';
  const diagnostic = status?.diagnostic;
  const selectedMode = isSuperGrok ? connectionDraft.accountLoginMode : 'device';
  const redirectUri = status?.redirectUri ?? (isSuperGrok && selectedMode === 'browser' ? SUPER_GROK_OAUTH_REDIRECT_URI : '');
  const clientIdSource = status?.clientIdSource ?? (connectionDraft.oauthClientId.trim() ? 'manual' : undefined);
  const noticeText = connectionAccountConnected
    ? t('settings.oauthConnectedHint')
    : connectionDevicePending
      ? connectionProvider.id === 'github-copilot'
        ? t('settings.githubAuthorizationPending')
        : selectedMode === 'browser'
          ? t('settings.oauthBrowserAuthorizationPending')
          : t('settings.oauthDeviceAuthorizationPending')
      : status?.message || (isSuperGrok ? t('settings.superGrokOAuthConnectHint') : t('settings.oauthConnectHint'));

  return (
    <div className="settings-provider-oauth-panel">
      <div className="settings-provider-notice">{noticeText}</div>

      {isSuperGrok && !connectionAccountConnected && (
        <>
          <div className="settings-provider-oauth-mode" role="group" aria-label={t('settings.oauthMode')}>
            {(['browser', 'device'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={
                  mode === selectedMode
                    ? 'settings-provider-oauth-mode-button active'
                    : 'settings-provider-oauth-mode-button'
                }
                data-testid={`settings-provider-oauth-mode-${mode}`}
                onClick={() => onUpdateConnectionDraft({
                  accountLoginMode: mode,
                  accountStatus: undefined,
                  authCode: '',
                  error: '',
                })}
                disabled={connectionDraft.busy !== 'idle' || connectionDevicePending}
              >
                {mode === 'browser' ? t('settings.oauthBrowserLogin') : t('settings.oauthDeviceCodeLogin')}
              </button>
            ))}
          </div>

          <label className="settings-field">
            <span className="settings-field-label">{t('settings.oauthClientId')}</span>
            <input
              className="input"
              data-testid="settings-provider-oauth-client-id"
              value={connectionDraft.oauthClientId}
              placeholder={t('settings.oauthClientIdPlaceholder')}
              disabled={connectionDraft.busy !== 'idle' || connectionDevicePending}
              onChange={(event) => onUpdateConnectionDraft({
                oauthClientId: event.target.value,
                error: '',
                accountStatus: status?.requiresClientId ? undefined : status,
              })}
            />
            <span className="settings-help-text">{t('settings.oauthClientIdHint')}</span>
          </label>

          <div className="settings-provider-oauth-detail-grid" data-testid="settings-provider-oauth-client-source">
            <span>{t('settings.oauthClientIdSource')}</span>
            <strong>{t(sourceLabelKey(clientIdSource))}</strong>
            {redirectUri && (
              <>
                <span>{t('settings.oauthRedirectUri')}</span>
                <code className="settings-provider-oauth-value">{redirectUri}</code>
              </>
            )}
            {(status?.requestedScopes || diagnostic?.requestedScopes) && (
              <>
                <span>{t('settings.oauthRequestedScopes')}</span>
                <code className="settings-provider-oauth-value">
                  {status?.requestedScopes ?? diagnostic?.requestedScopes}
                </code>
              </>
            )}
          </div>
        </>
      )}

      {connectionAccountConnected && (status?.accountLabel || status?.planLabel) && (
        <div className="settings-secret-status settings-provider-oauth-summary" data-testid="settings-provider-oauth-summary">
          <span>{[status.accountLabel, status.planLabel].filter(Boolean).join(t('settings.accountSummarySeparator'))}</span>
          <span>{t(status.oauthRefreshAvailable ? 'settings.oauthRefreshAvailable' : 'settings.oauthRefreshSession')}</span>
          <span>{t('settings.providerModelCount', { count: connectionDraft.models.length })}</span>
        </div>
      )}

      {!connectionAccountConnected && (
        <div className="settings-provider-oauth-actions">
          <button
            type="button"
            className="button button-secondary"
            data-testid="settings-provider-oauth-start"
            onClick={() => void onStartAccountLogin(selectedMode)}
            disabled={connectionDraft.busy !== 'idle' || connectionDevicePending}
          >
            {selectedMode === 'browser' ? t('settings.oauthStartBrowser') : t('settings.oauthStartDevice')}
          </button>
          {status?.authUrl && (
            <a className="settings-link" href={status.authUrl} target="_blank" rel="noreferrer">
              {t('settings.openAuthPage')}
            </a>
          )}
        </div>
      )}

      {!connectionAccountConnected && status?.verificationUri && (
        <div className="settings-provider-oauth-code-card" data-testid="settings-provider-oauth-device-card">
          <span>{status.verificationUri}</span>
          <strong data-testid="settings-provider-oauth-device-code">{status.userCode}</strong>
          <div className="settings-provider-oauth-code-actions">
            <button type="button" className="button button-ghost" onClick={() => copyText(status.userCode)}>
              {t('settings.copyCode')}
            </button>
            <button type="button" className="button button-ghost" onClick={() => copyText(status.verificationUri)}>
              {t('settings.copyLink')}
            </button>
          </div>
        </div>
      )}

      {!connectionAccountConnected && status?.requiresCodeInput && (
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

      {diagnostic && (
        <div className="settings-provider-oauth-diagnostic" data-testid="settings-provider-oauth-diagnostic">
          <strong>{diagnostic.summary}</strong>
          {diagnostic.providerError && <span>{t('settings.oauthProviderError', { error: diagnostic.providerError })}</span>}
          {diagnostic.detail && <span>{diagnostic.detail}</span>}
          {diagnostic.checklist && diagnostic.checklist.length > 0 && (
            <ul className="settings-provider-oauth-checklist">
              {diagnostic.checklist.map((item) => <li key={item}>{item}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
