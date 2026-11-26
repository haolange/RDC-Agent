import React from 'react';
import { Button } from '../../../../ui/Button';
import { useI18n } from '../../../../i18n';
import { authModeLabelKey } from './providerCardModel';
import type { LlmProviderAuthMode, LlmProviderEntry } from '@shared/types/settings';

interface ProviderAuthModeFieldProps {
  provider: LlmProviderEntry;
  value: LlmProviderAuthMode;
  disabled: boolean;
  onChange: (mode: LlmProviderAuthMode) => void;
}

export const ProviderAuthModeField: React.FC<ProviderAuthModeFieldProps> = ({
  provider,
  value,
  disabled,
  onChange,
}) => {
  const { t } = useI18n();
  const options = provider.authModeOptions ?? [provider.authMode];
  if (options.length < 2) return null;
  const selectedAvailability = provider.authModeAvailability?.[value] ?? provider.providerAvailability;
  // The manifest's reason is English provider data: it may explain in a tooltip, the visible line is product copy.
  const selectedState =
    selectedAvailability.state === 'unknown'
      ? t('settings.providerAuthUnverified')
      : selectedAvailability.state === 'unavailable'
        ? t('settings.providerAuthUnavailable')
        : '';

  return (
    <div className="settings-field settings-provider-auth-field">
      <span className="settings-field-label">{t('settings.providerAuthMode')}</span>
      <div className="settings-provider-auth-options" role="radiogroup" aria-label={t('settings.providerAuthMode')}>
        {options.map((mode) => {
          const availability = provider.authModeAvailability?.[mode] ?? provider.providerAvailability;
          const unavailable = availability.state === 'unavailable' || (mode === 'account' && !provider.accountLogin);
          const reason = availability.reason ?? (unavailable ? t('settings.providerAuthUnavailable') : undefined);
          return (
            <Button
              key={mode}
              variant="secondary"
              className={`settings-provider-auth-option${mode === value ? ' is-active' : ''}`}
              data-testid={`settings-provider-auth-mode-${mode}`}
              role="radio"
              aria-checked={mode === value}
              data-tooltip={reason}
              disabled={disabled || unavailable}
              onClick={() => onChange(mode)}
            >
              {t(authModeLabelKey(mode, provider))}
            </Button>
          );
        })}
      </div>
      {selectedState ? (
        <span
          className={`settings-provider-auth-state settings-provider-auth-state--${selectedAvailability.state}`}
          data-testid="settings-provider-auth-state"
          tabIndex={selectedAvailability.reason ? 0 : undefined}
          data-tooltip={selectedAvailability.reason}
        >
          {selectedState}
        </span>
      ) : null}
    </div>
  );
};
