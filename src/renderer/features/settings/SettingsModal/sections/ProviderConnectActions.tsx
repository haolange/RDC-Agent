import React from 'react';
import type { LlmProviderEntry } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { Button } from '../../../../ui/Button';
import type { ProviderConnectionDraft } from '../types';

type Translate = ReturnType<typeof useI18n>['t'];

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
  t: Translate;
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
  t,
}) => {
  const accountRequiresCode = provider.authMode === 'account' && draft.accountStatus?.requiresCodeInput;
  const accountSaveBlocked = provider.authMode === 'account'
    && !accountConnected
    && (!accountRequiresCode || !draft.authCode.trim());
  const accountTestBlocked = provider.authMode === 'account' && !accountConnected;
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
      >
        {draft.busy === 'testing' ? t('settings.testing') : t('settings.test')}
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
            : hasFreshTest ? t('settings.save') : t('settings.connect')}
      </Button>
    </>
  );
};
