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
 * Every label a button can show shares one grid cell, so the button is as wide as the widest of them and a swap to
 * the pending label never moves its neighbours.
 */
function StableLabel({ labels, shown }: { labels: string[]; shown: string }) {
  return (
    <span className="settings-provider-action-label">
      {[...new Set(labels)].map((label) => (
        <span
          key={label}
          className={`settings-provider-action-label-option${label === shown ? ' is-shown' : ''}`}
          aria-hidden={label === shown ? undefined : true}
        >
          {label}
        </span>
      ))}
    </span>
  );
}

/**
 * Single action bar for the connect dialog. Testing and saving swap only the button labels, which keep their width,
 * so the footer keeps its height, baseline and layout throughout.
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
  const accountSaveBlocked =
    provider.authMode === 'account' && !accountConnected && (!accountRequiresCode || !draft.authCode.trim());
  const accountTestBlocked =
    provider.authMode === 'account' && !accountConnected && provider.hasStoredSecretByAuthMode?.account !== true;
  const commonBlocked = draft.busy !== 'idle' || needsCredentials || needsBaseUrl || devicePending;
  const noSupportedModels = provider.catalogOwnership !== 'user-managed' && hasFreshTest && draft.models.length === 0;
  const authModeUnavailable =
    (provider.authModeAvailability?.[draft.authMode] ?? provider.providerAvailability).state === 'unavailable';

  const idleSaveLabel =
    provider.authMode === 'account'
      ? accountRequiresCode && !accountConnected
        ? t('settings.oauthContinue')
        : provider.isConfigured
          ? t('settings.save')
          : t('settings.connect')
      : provider.isConfigured || hasFreshTest
        ? t('settings.save')
        : t('settings.connect');
  const saveLabel = draft.busy === 'saving' ? t('settings.saving') : idleSaveLabel;
  const saveLabels = [idleSaveLabel, t('settings.saving')];

  return (
    <>
      <Button variant="ghost" onClick={onClose}>
        {t('settings.cancel')}
      </Button>
      <Button
        variant="secondary"
        data-testid="settings-provider-connect-test"
        onClick={() => void onTest()}
        disabled={commonBlocked || accountTestBlocked || authModeUnavailable}
        data-tooltip={t('settings.providers.checkConnectionHint')}
      >
        <StableLabel
          labels={[t('settings.providers.checkConnection'), t('settings.testing')]}
          shown={draft.busy === 'testing' ? t('settings.testing') : t('settings.providers.checkConnection')}
        />
      </Button>
      <Button
        variant="primary"
        data-testid="settings-provider-connect-save"
        onClick={() => void onSave()}
        disabled={commonBlocked || accountSaveBlocked || noSupportedModels || authModeUnavailable}
      >
        <StableLabel labels={saveLabels} shown={saveLabel} />
      </Button>
    </>
  );
};
