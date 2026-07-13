import React from 'react';
import type { LlmProviderEntry } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import type { ProviderConnectionDraft } from '../types';

type Translate = ReturnType<typeof useI18n>['t'];

interface ProviderConnectActionsProps {
  draft: ProviderConnectionDraft;
  provider: LlmProviderEntry;
  accountConnected: boolean;
  devicePending: boolean;
  needsApiKey: boolean;
  needsBaseUrl: boolean;
  hasFreshTest: boolean;
  onClose: () => void;
  onTest: () => void | Promise<void>;
  onSave: () => void | Promise<void>;
  t: Translate;
}

export const ProviderConnectActions: React.FC<ProviderConnectActionsProps> = ({
  draft,
  provider,
  accountConnected,
  devicePending,
  needsApiKey,
  needsBaseUrl,
  hasFreshTest,
  onClose,
  onTest,
  onSave,
  t,
}) => {
  const accountRequiresCode = provider.authMode === 'account' && draft.accountStatus?.requiresCodeInput;
  const accountSaveBlocked = provider.authMode === 'account'
    && !accountConnected
    && (!accountRequiresCode || !draft.authCode.trim());
  const accountTestBlocked = provider.authMode === 'account' && !accountConnected;
  const commonBlocked = draft.busy !== 'idle' || needsApiKey || needsBaseUrl || devicePending;
  const noSupportedModels = provider.catalogOwnership === 'app-managed' && hasFreshTest && draft.models.length === 0;
  const authModeUnavailable = (provider.authModeAvailability?.[draft.authMode]
    ?? provider.providerAvailability).state === 'unavailable';

  return (
    <div className="settings-actions settings-provider-connect-actions">
      <button type="button" className="button button-secondary" onClick={onClose}>{t('settings.cancel')}</button>
      <button
        type="button"
        className="button button-secondary"
        data-testid="settings-provider-connect-test"
        onClick={() => void onTest()}
        disabled={commonBlocked || accountTestBlocked || authModeUnavailable}
      >
        {draft.busy === 'testing' ? t('settings.testing') : t('settings.test')}
      </button>
      <button
        type="button"
        className="button button-primary"
        data-testid="settings-provider-connect-save"
        onClick={() => void onSave()}
        disabled={commonBlocked || accountSaveBlocked || noSupportedModels || authModeUnavailable}
      >
        {draft.busy === 'saving'
          ? t('settings.saving')
          : provider.authMode === 'account'
            ? provider.isConfigured ? t('settings.save') : t('settings.connect')
            : hasFreshTest ? t('settings.save') : t('settings.connect')}
      </button>
    </div>
  );
};
