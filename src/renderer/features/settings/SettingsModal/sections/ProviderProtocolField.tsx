import React from 'react';
import type { useI18n } from '../../../../i18n';
import type { ProviderProtocol } from '../types';
import { getProviderProtocolLabel, providerShowsResponsesHint } from '../utils';

type Translate = ReturnType<typeof useI18n>['t'];

interface ProviderProtocolFieldProps {
  value: ProviderProtocol;
  options: ProviderProtocol[];
  disabled: boolean;
  readOnly?: boolean;
  onChange: (protocol: ProviderProtocol) => void;
  t: Translate;
}

export const ProviderProtocolField: React.FC<ProviderProtocolFieldProps> = ({
  value,
  options,
  disabled,
  readOnly = false,
  onChange,
  t,
}) => (
  <>
    {readOnly ? (
      <div className="settings-field settings-provider-protocol-field">
        <span className="settings-field-label">{t('settings.providerProtocol')}</span>
        <span className="settings-provider-protocol-readonly" data-testid="settings-provider-connect-protocol-badge">
          {getProviderProtocolLabel(value)}
        </span>
      </div>
    ) : (
      <label className="settings-field settings-provider-protocol-field">
        <span className="settings-field-label">{t('settings.providerProtocol')}</span>
        <select
          className="input"
          data-testid="settings-provider-connect-protocol"
          value={value}
          onChange={(event) => onChange(event.target.value as ProviderProtocol)}
          disabled={disabled}
        >
          {options.map((protocol) => (
            <option key={protocol} value={protocol}>{getProviderProtocolLabel(protocol)}</option>
          ))}
        </select>
        <span className="settings-help-text">{t('settings.providerProtocolHint')}</span>
      </label>
    )}

    {providerShowsResponsesHint(value) && (
      <div className="settings-provider-notice settings-provider-notice--compact" data-testid="settings-provider-responses-hint">
        {t('settings.providerResponsesHint')}
      </div>
    )}
  </>
);
