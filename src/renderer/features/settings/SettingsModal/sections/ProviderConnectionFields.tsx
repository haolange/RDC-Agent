import React from 'react';
import { Button } from '../../../../ui/Button';
import { englishTranslations, type TranslationKey } from '../../../../i18n/messages';
import { SettingsField } from '../parts';
import {
  projectEndpointTemplate,
  resolvePrimarySecretField,
} from '../providerConnectionState';
import { STORED_SECRET_MASK } from '../utils';
import type { LlmProviderConnectionField, LlmProviderEntry } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import type { ProviderConnectionDraft } from '../types';

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

function connectionLabel(kind: 'field' | 'method', id: string, label: string, t: Translate) {
  const key = `settings.connection.${kind}.${id}`;
  if (Object.hasOwn(englishTranslations, key)) return t(key as TranslationKey);
  if (kind === 'field' && /\bapi key$/iu.test(label)) return t('settings.apiKey');
  return label;
}

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
          <SettingsField label={t('settings.providerBaseUrl')} htmlFor="settings-provider-base-url-input">
            <input
              id="settings-provider-base-url-input"
              className="input"
              data-testid="settings-provider-connect-base-url"
              value={connectionDraft.baseUrl}
              onChange={(event) => onUpdateConnectionDraft({ baseUrl: event.target.value, ...resetTest })}
            />
          </SettingsField>
        )}
        <SettingsField label={t('settings.apiKey')} htmlFor="settings-provider-api-key-input"
          description={t(connectionDraft.usingStoredSecret ? 'settings.apiKeyStoredHint' : 'settings.apiKeyConnectHint')}>
          <div className="settings-secret-field">
            <input
              className="input settings-secret-input"
              data-testid="settings-provider-connect-api-key"
              id="settings-provider-api-key-input"
              type={connectionDraft.showApiKey && !connectionDraft.usingStoredSecret ? 'text' : 'password'}
              value={connectionDraft.usingStoredSecret ? STORED_SECRET_MASK : connectionDraft.apiKey}
              readOnly={connectionDraft.usingStoredSecret || connectionDraft.busy !== 'idle'}
              onChange={(event) => onUpdateConnectionDraft({
                apiKey: event.target.value,
                usingStoredSecret: false,
                ...resetTest,
              })}
            />
            <Button
              size="sm"
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
              disabled={connectionDraft.busy !== 'idle' || (!connectionDraft.usingStoredSecret && !connectionDraft.apiKey)}
            >
              {connectionDraft.usingStoredSecret
                ? t('settings.replaceSecret')
                : connectionDraft.showApiKey ? t('settings.hideSecret') : t('settings.showSecret')}
            </Button>
          </div>
        </SettingsField>
      </>
    );
  }

  const endpointTemplate = connectionDraft.baseUrl || schema.endpointTemplate;
  const publicFields = schema.fields.filter(field => field.kind !== 'secret');
  const publicValues = Object.fromEntries(publicFields.map(field => [field.id, connectionDraft.connectionValues[field.id] ?? '']));
  const endpoint = projectEndpointTemplate(endpointTemplate, publicValues);
  const showEndpoint = endpoint !== endpointTemplate && !endpoint.includes('${') && /^https?:\/\//iu.test(endpoint)
    && URL.canParse(endpoint) && !Object.values(publicValues).some(value => value.trim().replace(/\/+$/u, '') === endpoint.replace(/\/+$/u, ''));

  return (
    <div className="settings-provider-connection-fields" data-testid="settings-provider-connection-fields">
      {schema.fields.map((field) => {
        const usingStoredSecret = field.kind === 'secret'
          && connectionDraft.usingStoredConnectionSecrets[field.id] === true;
        const visible = connectionDraft.visibleConnectionSecrets[field.id] === true;
        return (
          <SettingsField key={field.id} htmlFor={`settings-provider-input-${field.id}`} label={
            <span className="settings-connection-field-label">
              {connectionLabel('field', field.id, field.label, t)}
              {field.required ? <span className="settings-required-field" aria-hidden="true">{t('settings.connectionRequired')}</span> : null}
            </span>
          }>
            {field.kind === 'secret' ? (
              <div className="settings-secret-field">
                <input
                  className="input settings-secret-input"
                  id={`settings-provider-input-${field.id}`}
                  aria-required={field.required}
                  data-testid={`settings-provider-connect-field-${field.id}`}
                  type={visible && !usingStoredSecret ? 'text' : 'password'}
                  value={usingStoredSecret ? STORED_SECRET_MASK : connectionDraft.connectionValues[field.id] ?? ''}
                  placeholder={field.placeholder ?? ''}
                  readOnly={usingStoredSecret || connectionDraft.busy !== 'idle'}
                  onChange={(event) => updateField(field, event.target.value)}
                />
                <Button
                  size="sm"
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
                  disabled={connectionDraft.busy !== 'idle' || (!usingStoredSecret && !connectionDraft.connectionValues[field.id])}
                >
                  {usingStoredSecret
                    ? t('settings.replaceSecret')
                    : visible ? t('settings.hideSecret') : t('settings.showSecret')}
                </Button>
              </div>
            ) : (
              <input
                className="input"
                id={`settings-provider-input-${field.id}`}
                aria-required={field.required}
                data-testid={`settings-provider-connect-field-${field.id}`}
                type={inputTypeFor(field)}
                value={connectionDraft.connectionValues[field.id] ?? ''}
                placeholder={field.placeholder ?? ''}
                autoComplete="off"
                onChange={(event) => updateField(field, event.target.value)}
              />
            )}
          </SettingsField>
        );
      })}

      {schema.credentialAlternatives?.length ? (
        <div className="settings-provider-credential-options" data-testid="settings-provider-credential-options">
          <span className="settings-field-label">{t('settings.connectionCredentialOptions')}</span>
          <span className="settings-provider-credential-options-value">
            {schema.credentialAlternatives.map(option => connectionLabel('method', option.id, option.label ?? option.id, t)).join(' / ')}
          </span>
        </div>
      ) : null}

      {showEndpoint ? (
        <div className="settings-field settings-provider-endpoint-preview">
          <span className="settings-field-label">{t('settings.connectionEndpointPreview')}</span>
          <span className="settings-provider-endpoint-value" data-testid="settings-provider-connect-endpoint-preview">{endpoint}</span>
        </div>
      ) : null}
    </div>
  );
};
