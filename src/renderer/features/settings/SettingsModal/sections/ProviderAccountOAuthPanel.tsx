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
  const isOpenRouter = connectionProvider.id === 'openrouter';
  const isMiniMax = connectionProvider.id === 'minimax-account';
  const diagnostic = status?.diagnostic;
  const selectedMode = isSuperGrok ? connectionDraft.accountLoginMode : isOpenRouter ? 'browser' : 'device';
  const redirectUri = status?.redirectUri ?? (isSuperGrok && selectedMode === 'browser' ? SUPER_GROK_OAUTH_REDIRECT_URI : '');
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
                    ? 'button button-secondary settings-provider-oauth-mode-button active'
                    : 'button button-secondary settings-provider-oauth-mode-button'
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

          <div className="settings-provider-oauth-detail-grid" data-testid="settings-provider-oauth-details">
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

      {isMiniMax && !connectionAccountConnected && (
        <div className="settings-provider-oauth-mode" role="group" aria-label={t('settings.oauthRegion')}>
          {(['global', 'cn'] as const).map((region) => (
            <button
              key={region}
              type="button"
              className={`button button-secondary settings-provider-oauth-mode-button${connectionDraft.accountRegion === region ? ' active' : ''}`}
              data-testid={`settings-provider-oauth-region-${region}`}
              onClick={() => onUpdateConnectionDraft({
                accountRegion: region,
                accountStatus: undefined,
                error: '',
              })}
              disabled={connectionDraft.busy !== 'idle' || connectionDevicePending}
            >
              {region === 'global' ? t('settings.oauthRegionGlobal') : t('settings.oauthRegionChina')}
            </button>
          ))}
        </div>
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
