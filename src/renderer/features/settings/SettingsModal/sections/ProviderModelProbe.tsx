import type { LlmModelCapabilityProbeMode } from '@shared/types/settings';
import { Button } from '../../../../ui/Button';
import type { ProviderModelCapabilitySummaryProps } from './ProviderModelCapabilitySummary';

interface Props extends Pick<ProviderModelCapabilitySummaryProps, 'model' | 'provider' | 't'> {
  probeMode: LlmModelCapabilityProbeMode | null;
  probeModes: LlmModelCapabilityProbeMode[];
  runProbe: (mode: LlmModelCapabilityProbeMode) => Promise<void>;
}

export function ProviderModelProbe({ model, provider, t, probeMode, probeModes, runProbe }: Props) {
  return (
    <div className="settings-model-capability-probe" data-testid={`settings-provider-model-probe-${model.id}`}>
      <div className="settings-model-preferences-heading">
        <span className="settings-model-capability-section-label">{t('settings.providers.capability.probe')}</span>
        <span className="settings-help-text">{t('settings.providers.capability.probeHint')}</span>
      </div>
      <div className="settings-model-capability-probe-actions">
        {probeModes.map((mode) => (
          <Button
            key={mode}
            type="button"
            size="sm"
            disabled={!provider.isConfigured || !model.enabled || probeMode !== null}
            onClick={() => void runProbe(mode)}
          >
            {probeMode === mode
              ? t('settings.providers.capability.probing')
              : t(`settings.providers.capability.probeMode.${mode}`)}
          </Button>
        ))}
      </div>
      {!provider.isConfigured ? (
        <span className="settings-help-text">{t('settings.providers.capability.probeRequiresConnection')}</span>
      ) : null}
    </div>
  );
}
