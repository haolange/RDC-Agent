import React from 'react';
import type { LlmProviderAuthMode, LlmProviderEntry } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];

interface ProviderAuthModeFieldProps {
  provider: LlmProviderEntry;
  value: LlmProviderAuthMode;
  disabled: boolean;
  onChange: (mode: LlmProviderAuthMode) => void;
  t: Translate;
}

const authModeLabel = (mode: LlmProviderAuthMode, t: Translate): string => {
  if (mode === 'api-key') return t('settings.providerAuthApiKey');
  if (mode === 'account') return t('settings.providerAuthAccount');
  if (mode === 'environment') return t('settings.providerAuthEnvironment');
  return t('settings.providerAuthLocal');
};

export const ProviderAuthModeField: React.FC<ProviderAuthModeFieldProps> = ({
  provider,
  value,
  disabled,
  onChange,
  t,
}) => {
  const options = provider.authModeOptions ?? [provider.authMode];
  if (options.length < 2) return null;
  const selectedAvailability = provider.authModeAvailability?.[value] ?? provider.providerAvailability;
  const selectedReason = selectedAvailability.reason
    ?? (selectedAvailability.state === 'unknown' ? t('settings.providerAuthUnverified') : '');

  return (
    <div className="settings-field settings-provider-auth-field">
      <span className="settings-field-label">{t('settings.providerAuthMode')}</span>
      <div className="settings-provider-auth-options" role="radiogroup" aria-label={t('settings.providerAuthMode')}>
        {options.map((mode) => {
          const availability = provider.authModeAvailability?.[mode] ?? provider.providerAvailability;
          const unavailable = availability.state === 'unavailable'
            || (mode === 'account' && !provider.accountLoginConfigured);
          const reason = availability.reason
            ?? (unavailable ? t('settings.providerAuthUnavailable') : undefined);
          return (
            <button
              key={mode}
              type="button"
              className={`button button-secondary settings-provider-auth-option${mode === value ? ' is-active' : ''}`}
              data-testid={`settings-provider-auth-mode-${mode}`}
              role="radio"
              aria-checked={mode === value}
              title={reason}
              disabled={disabled || unavailable}
              onClick={() => onChange(mode)}
            >
              {authModeLabel(mode, t)}
            </button>
          );
        })}
      </div>
      {selectedAvailability.state !== 'available' && selectedReason ? (
        <span
          className={`settings-help-text settings-provider-auth-state settings-provider-auth-state--${selectedAvailability.state}`}
          data-testid="settings-provider-auth-state"
        >
          {selectedReason}
        </span>
      ) : null}
    </div>
  );
};
