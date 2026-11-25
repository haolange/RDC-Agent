import React, { type ReactNode } from 'react';
import { Button } from '../../../../ui/Button';
import { Icon } from '../../../../ui/Icon';
import { Input } from '../../../../ui/Input';
import { Spinner } from '../../../../ui/Spinner';
import { useI18n } from '../../../../i18n';
import type { LlmProviderEntry } from '@shared/types/settings';
import type { ProviderConnectionDraft } from '../types';

interface ProviderAccountOAuthPanelProps {
  connectionDraft: ProviderConnectionDraft;
  connectionProvider: LlmProviderEntry;
  connectionAccountConnected: boolean;
  connectionDevicePending: boolean;
  onUpdateConnectionDraft: (patch: Partial<ProviderConnectionDraft>) => void;
  onStartAccountLogin: () => void | Promise<void>;
}

const copyText = (value?: string) => {
  if (!value) return;
  void navigator.clipboard?.writeText(value);
};

type StepState = 'pending' | 'active' | 'done';

const Step: React.FC<{ index: number; state: StepState; title: string; description?: string; children?: ReactNode; testId?: string }> = ({
  index,
  state,
  title,
  description,
  children,
  testId,
}) => (
  <li className="settings-oauth-step" data-state={state} data-testid={testId}>
    <span className="settings-oauth-step-index" aria-hidden="true">
      {state === 'done' ? <Icon name="check" size={12} /> : index}
    </span>
    <div className="settings-oauth-step-body">
      <div className="settings-oauth-step-title">{title}</div>
      {description ? <p className="settings-oauth-step-description">{description}</p> : null}
      {children}
    </div>
  </li>
);

/**
 * Account login as a short step list, shaped by the provider's declared sign-in. Device flow: open page →
 * enter code → wait. Browser flow: sign in, then paste the code or wait for the automatic callback. The
 * footer Connect/Save button remains the single submit; codes never persist to logs.
 */
export const ProviderAccountOAuthPanel: React.FC<ProviderAccountOAuthPanelProps> = ({
  connectionDraft,
  connectionProvider,
  connectionAccountConnected,
  connectionDevicePending,
  onUpdateConnectionDraft,
  onStartAccountLogin,
}) => {
  const { t } = useI18n();
  const status = connectionDraft.accountStatus;
  const diagnostic = status?.diagnostic;
  const selectedMode = connectionProvider.accountLogin?.mode ?? 'device';
  const browserCallback = selectedMode === 'browser' && !connectionProvider.accountLogin?.codeInput;
  const busy = connectionDraft.busy !== 'idle';
  const isAuthorizationPending = connectionDevicePending || busy;
  const isBrowserCodePending = selectedMode === 'browser' && status?.requiresCodeInput === true;
  const started = Boolean(status?.verificationUri || status?.authUrl || connectionDevicePending || isBrowserCodePending);

  if (connectionAccountConnected) {
    return (
      <div className="settings-provider-oauth-panel">
        {(status?.accountLabel || status?.planLabel) ? (
          <p className="settings-provider-oauth-account" data-testid="settings-provider-oauth-summary">
            {[status.accountLabel, status.planLabel].filter(Boolean).join(' · ')}
          </p>
        ) : null}
      </div>
    );
  }

  // A failed callback flow starts over instead of reopening its stale authorization page.
  const openPageButton = status?.authUrl && (!browserCallback || connectionDevicePending) ? (
    <a
      className="button button-primary button-sm settings-oauth-link-button"
      href={status.authUrl}
      target="_blank"
      rel="noreferrer"
      data-testid="settings-provider-oauth-open-page"
    >
      <Icon name="external" size={14} />
      {t(started && (isBrowserCodePending || connectionDevicePending) ? 'settings.reopenAuthPage' : 'settings.openAuthPage')}
    </a>
  ) : (
    <Button
      variant="primary"
      size="sm"
      data-testid="settings-provider-oauth-start"
      onClick={() => void onStartAccountLogin()}
      disabled={busy || connectionDevicePending}
    >
      {isAuthorizationPending
        ? t(selectedMode === 'browser' ? 'settings.oauthWaitingBrowser' : 'settings.oauthWaitingDevice')
        : t(selectedMode === 'browser' ? 'settings.oauthStartBrowser' : 'settings.oauthStartDevice')}
    </Button>
  );

  return (
    <div className="settings-provider-oauth-panel">
      <div className="settings-provider-notice">
        {t(browserCallback ? 'settings.oauthBrowserConnectHint' : 'settings.oauthConnectHint')}
      </div>

      <ol className="settings-oauth-steps" data-testid="settings-provider-oauth-steps" data-mode={selectedMode}>
        {selectedMode === 'device' ? (
          <>
            <Step
              index={1}
              state={started ? 'done' : 'active'}
              title={t('settings.oauthStepOpenPage')}
              description={t('settings.oauthStepOpenPageHint')}
            >
              <div className="settings-provider-oauth-actions">{openPageButton}</div>
            </Step>
            <Step
              index={2}
              state={status?.userCode ? 'active' : 'pending'}
              title={t('settings.oauthStepEnterCode')}
              description={t('settings.oauthStepEnterCodeHint')}
              testId="settings-provider-oauth-device-card"
            >
              {status?.userCode ? (
                <div className="settings-provider-oauth-code-card">
                  <code data-testid="settings-provider-oauth-device-code">{status.userCode}</code>
                  <Button variant="secondary" size="sm" onClick={() => copyText(status.userCode)}>
                    <Icon name="copy" size={14} />
                    {t('settings.copyCode')}
                  </Button>
                  {status.verificationUri ? (
                    <Button variant="ghost" size="sm" onClick={() => copyText(status.verificationUri)}>
                      {t('settings.copyLink')}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </Step>
            <Step
              index={3}
              state={connectionDevicePending ? 'active' : 'pending'}
              title={t('settings.oauthStepWait')}
              description={t('settings.oauthStepWaitHint')}
            >
              {connectionDevicePending ? (
                <div className="settings-oauth-waiting" role="status" data-testid="settings-provider-oauth-waiting">
                  <Spinner size="sm" />
                  <span>{t('settings.oauthDeviceAuthorizationPending')}</span>
                </div>
              ) : null}
            </Step>
          </>
        ) : (
          <>
            <Step
              index={1}
              state={started ? 'done' : 'active'}
              title={t('settings.oauthStepBrowserLogin')}
              description={t('settings.oauthStepBrowserLoginHint')}
            >
              <div className="settings-provider-oauth-actions">
                {isBrowserCodePending ? (
                  <div className="settings-oauth-browser-opened" data-testid="settings-provider-oauth-browser-opened">
                    <Icon name="check" size={14} />
                    <span>{t('settings.oauthBrowserOpened')}</span>
                    <Button variant="secondary" size="sm" onClick={() => void onStartAccountLogin()} disabled={busy}>
                      {t('settings.reopenBrowser')}
                    </Button>
                  </div>
                ) : openPageButton}
              </div>
            </Step>
            <Step
              index={2}
              state={started ? 'active' : 'pending'}
              title={t(browserCallback ? 'settings.oauthStepWait' : 'settings.oauthStepPasteCode')}
              description={t(browserCallback ? 'settings.oauthStepWaitHint' : 'settings.oauthStepPasteCodeHint')}
            >
              {status?.requiresCodeInput ? (
                <div className="settings-provider-oauth-manual-code">
                  <Input
                    data-testid="settings-provider-oauth-code"
                    autoComplete="one-time-code"
                    spellCheck={false}
                    aria-label={t('settings.oauthCode')}
                    placeholder={t('settings.oauthCodePlaceholder')}
                    value={connectionDraft.authCode}
                    onChange={(event) => onUpdateConnectionDraft({ authCode: event.target.value, error: '' })}
                  />

                </div>
              ) : null}
            </Step>
          </>
        )}
      </ol>

      {diagnostic?.checklist && diagnostic.checklist.length > 0 ? (
        <ul className="settings-provider-oauth-checklist">
          {diagnostic.checklist.map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : null}

    </div>
  );
};
