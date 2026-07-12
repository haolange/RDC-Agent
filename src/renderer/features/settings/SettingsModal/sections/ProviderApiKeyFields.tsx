import React from 'react';
import type { LlmProviderEntry } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import type { ProviderConnectionDraft } from '../types';
import { STORED_SECRET_MASK } from '../utils';

type Translate = ReturnType<typeof useI18n>['t'];

interface ProviderApiKeyFieldsProps {
  connectionDraft: ProviderConnectionDraft;
  connectionProvider: LlmProviderEntry;
  onUpdateConnectionDraft: (patch: Partial<ProviderConnectionDraft>) => void;
  t: Translate;
}

export const ProviderApiKeyFields: React.FC<ProviderApiKeyFieldsProps> = ({
  connectionDraft,
  connectionProvider,
  onUpdateConnectionDraft,
  t,
}) => (
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
            discoveryDiagnostic: null,
            testedApiKey: '',
            testedBaseUrl: '',
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
            discoveryDiagnostic: null,
            testedApiKey: '',
            testedBaseUrl: '',
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
);
