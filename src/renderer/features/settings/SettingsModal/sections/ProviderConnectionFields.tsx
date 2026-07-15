import React from 'react';
import type { LlmProviderConnectionField, LlmProviderEntry } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import {
  projectEndpointTemplate,
  resolvePrimarySecretField,
} from '../providerConnectionState';
import type { ProviderConnectionDraft } from '../types';
import { STORED_SECRET_MASK } from '../utils';

type Translate = ReturnType<typeof useI18n>['t'];

interface ProviderConnectionFieldsProps {
  connectionDraft: ProviderConnectionDraft;
  connectionProvider: LlmProviderEntry;
  onUpdateConnectionDraft: (patch: Partial<ProviderConnectionDraft>) => void;
  t: Translate;
}

const resetTest = {
  error: '',
  discoveryDiagnostic: null,
  testedApiKey: '',
  testedBaseUrl: '',
  testedConnectionSignature: '',
  models: [],
};

const inputTypeFor = (field: LlmProviderConnectionField): React.HTMLInputTypeAttribute => (
  field.kind === 'url' ? 'url' : 'text'
);

export const ProviderConnectionFields: React.FC<ProviderConnectionFieldsProps> = ({
  connectionDraft,
  connectionProvider,
  onUpdateConnectionDraft,
  t,
}) => {
  const schema = connectionProvider.connectionSchema;
  const primarySecret = resolvePrimarySecretField(schema);

  const updateField = (field: LlmProviderConnectionField, value: string) => {
    const connectionValues = { ...connectionDraft.connectionValues, [field.id]: value };
    const usingStoredConnectionSecrets = {
      ...connectionDraft.usingStoredConnectionSecrets,
      ...(field.kind === 'secret' ? { [field.id]: false } : {}),
    };
    onUpdateConnectionDraft({
      connectionValues,
      usingStoredConnectionSecrets,
      ...(field.id === primarySecret?.id
        ? { apiKey: value, usingStoredSecret: false }
        : {}),
      ...(field.id === 'baseUrl' ? { baseUrl: value } : {}),
      ...resetTest,
    });
  };

  const replaceStoredSecret = (field: LlmProviderConnectionField) => {
    onUpdateConnectionDraft({
      connectionValues: { ...connectionDraft.connectionValues, [field.id]: '' },
      usingStoredConnectionSecrets: {
        ...connectionDraft.usingStoredConnectionSecrets,
        [field.id]: false,
      },
      visibleConnectionSecrets: {
        ...connectionDraft.visibleConnectionSecrets,
        [field.id]: false,
      },
      ...(field.id === primarySecret?.id ? { apiKey: '', usingStoredSecret: false } : {}),
      ...resetTest,
    });
  };

  if (!schema?.fields.length) {
    return (
      <>
        {connectionProvider.baseUrlEditable && (
          <label className="settings-field">
            <span className="settings-field-label">{t('settings.providerBaseUrl')}</span>
            <input
              className="input"
              data-testid="settings-provider-connect-base-url"
              value={connectionDraft.baseUrl}
              onChange={(event) => onUpdateConnectionDraft({ baseUrl: event.target.value, ...resetTest })}
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
              onFocus={() => {
                if (connectionDraft.usingStoredSecret) {
                  onUpdateConnectionDraft({ usingStoredSecret: false, apiKey: '', showApiKey: false });
                }
              }}
              onChange={(event) => onUpdateConnectionDraft({
                apiKey: event.target.value,
                usingStoredSecret: false,
                ...resetTest,
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
              aria-label={connectionDraft.usingStoredSecret
                ? t('settings.replaceSecret')
                : connectionDraft.showApiKey ? t('settings.hideSecret') : t('settings.showSecret')}
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
  }

  const endpointTemplate = connectionDraft.baseUrl || schema.endpointTemplate;
  const endpointPreview = projectEndpointTemplate(endpointTemplate, connectionDraft.connectionValues);

  return (
    <div className="settings-provider-connection-fields" data-testid="settings-provider-connection-fields">
      {schema.fields.map((field) => {
        const usingStoredSecret = field.kind === 'secret'
          && connectionDraft.usingStoredConnectionSecrets[field.id] === true;
        const visible = connectionDraft.visibleConnectionSecrets[field.id] === true;
        return (
          <label className="settings-field" key={field.id}>
            <span className="settings-field-label settings-connection-field-label">
              <span>{field.label}</span>
              {field.required ? <span className="settings-required-field">{t('settings.connectionRequired')}</span> : null}
            </span>
            {field.kind === 'secret' ? (
              <div className="settings-secret-field">
                <input
                  className="input settings-secret-input"
                  data-testid={`settings-provider-connect-field-${field.id}`}
                  type={visible && !usingStoredSecret ? 'text' : 'password'}
                  value={usingStoredSecret ? STORED_SECRET_MASK : connectionDraft.connectionValues[field.id] ?? ''}
                  placeholder={field.placeholder ?? ''}
                  onFocus={() => {
                    if (usingStoredSecret) replaceStoredSecret(field);
                  }}
                  onChange={(event) => updateField(field, event.target.value)}
                />
                <button
                  type="button"
                  className="settings-secret-toggle"
                  data-testid={`settings-provider-connect-field-toggle-${field.id}`}
                  onClick={() => {
                    if (usingStoredSecret) {
                      replaceStoredSecret(field);
                      return;
                    }
                    onUpdateConnectionDraft({
                      visibleConnectionSecrets: {
                        ...connectionDraft.visibleConnectionSecrets,
                        [field.id]: !visible,
                      },
                    });
                  }}
                  aria-label={usingStoredSecret
                    ? t('settings.replaceSecret')
                    : visible ? t('settings.hideSecret') : t('settings.showSecret')}
                  disabled={!usingStoredSecret && !connectionDraft.connectionValues[field.id]}
                >
                  {usingStoredSecret
                    ? t('settings.replaceSecret')
                    : visible ? t('settings.hideSecret') : t('settings.showSecret')}
                </button>
              </div>
            ) : (
              <input
                className="input"
                data-testid={`settings-provider-connect-field-${field.id}`}
                type={inputTypeFor(field)}
                value={connectionDraft.connectionValues[field.id] ?? ''}
                placeholder={field.placeholder ?? ''}
                autoComplete="off"
                onChange={(event) => updateField(field, event.target.value)}
              />
            )}
            {usingStoredSecret ? (
              <span className="settings-help-text">{t('settings.connectionSecretStored')}</span>
            ) : null}
          </label>
        );
      })}

      {schema.credentialAlternatives?.length ? (
        <div className="settings-provider-credential-options" data-testid="settings-provider-credential-options">
          <span className="settings-field-label">{t('settings.connectionCredentialOptions')}</span>
          <span className="settings-help-text">
            {schema.credentialAlternatives.map((alternative) => alternative.label ?? alternative.id).join(' / ')}
          </span>
        </div>
      ) : null}

      {endpointPreview ? (
        <div className="settings-field settings-provider-endpoint-preview">
          <span className="settings-field-label">{t('settings.connectionEndpointPreview')}</span>
          <code data-testid="settings-provider-connect-endpoint-preview">{endpointPreview}</code>
        </div>
      ) : null}
    </div>
  );
};
