import React from 'react';
import { Button } from '../../../../ui/Button';
import { useI18n } from '../../../../i18n';
import type { LlmProviderEntry } from '@shared/types/settings';
import type { ProviderConnectionDraft } from '../types';

interface ProviderConnectActionsProps {
  draft: ProviderConnectionDraft;
  provider: LlmProviderEntry;
  accountConnected: boolean;
  devicePending: boolean;
  needsCredentials: boolean;
  needsBaseUrl: boolean;
  hasFreshTest: boolean;
  onClose: () => void;
  onTest: () => void | Promise<void>;
  onSave: () => void | Promise<void>;
}

/**
 * Single action bar for the connect dialog. Testing swaps only the button
 * label, so the footer keeps its height and baseline throughout a test.
 */
export const ProviderConnectActions: React.FC<ProviderConnectActionsProps> = ({
  draft,
  provider,
  accountConnected,
  devicePending,
  needsCredentials,
  needsBaseUrl,
  hasFreshTest,
  onClose,
  onTest,
  onSave,
}) => {
  const { t } = useI18n();
  const accountRequiresCode = provider.authMode === 'account' && draft.accountStatus?.requiresCodeInput;
  const accountSaveBlocked = provider.authMode === 'account'
    && !accountConnected
    && (!accountRequiresCode || !draft.authCode.trim());
  const accountTestBlocked = provider.authMode === 'account'
    && !accountConnected
    && provider.hasStoredSecretByAuthMode?.account !== true;
  const commonBlocked = draft.busy !== 'idle' || needsCredentials || needsBaseUrl || devicePending;
  const noSupportedModels = provider.catalogOwnership !== 'user-managed' && hasFreshTest && draft.models.length === 0;
  const authModeUnavailable = (provider.authModeAvailability?.[draft.authMode]
    ?? provider.providerAvailability).state === 'unavailable';

  return (
    <>
      <Button variant="ghost" onClick={onClose}>{t('settings.cancel')}</Button>
      <Button
        variant="secondary"
        data-testid="settings-provider-connect-test"
        onClick={() => void onTest()}
        disabled={commonBlocked || accountTestBlocked || authModeUnavailable}
        data-tooltip={t('settings.providers.checkConnectionHint')}
      >
        {draft.busy === 'testing' ? t('settings.testing') : t('settings.providers.checkConnection')}
      </Button>
      <Button
        variant="primary"
        data-testid="settings-provider-connect-save"
        onClick={() => void onSave()}
        disabled={commonBlocked || accountSaveBlocked || noSupportedModels || authModeUnavailable}
      >
        {draft.busy === 'saving'
          ? t('settings.saving')
          : provider.authMode === 'account'
            ? accountRequiresCode && !accountConnected
              ? t('settings.oauthContinue')
              : provider.isConfigured ? t('settings.save') : t('settings.connect')
            : provider.isConfigured || hasFreshTest ? t('settings.save') : t('settings.connect')}
      </Button>
    </>
  );
};
