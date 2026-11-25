import { Button } from '../../../../ui/Button';
import { SplitButton } from '../../../../ui/SplitButton';
import { useI18n } from '../../../../i18n';
import type { LlmModelCapabilityProbeMode } from '@shared/types/settings';
import type { ProviderModelCapabilitySummaryProps } from './ProviderModelCapabilitySummary';

interface Props extends Pick<ProviderModelCapabilitySummaryProps, 'model' | 'provider'> {
  probeMode: LlmModelCapabilityProbeMode | null;
  probeModes: LlmModelCapabilityProbeMode[];
  runProbe: (mode: LlmModelCapabilityProbeMode) => Promise<void>;
}

export function ProviderModelProbe({ model, provider,  probeMode, probeModes, runProbe }: Props) {
  const { t } = useI18n();
  const disabled = !provider.isConfigured || !model.enabled || probeMode !== null;
  const modes = probeModes.filter(mode => mode !== 'default');
  const label = probeMode ? t('settings.providers.capability.probing')
    : t(modes.length ? 'settings.providers.capability.probeMode.default' : 'settings.providers.batch.start');
  return (
    <div className="settings-model-capability-probe" data-testid={`settings-provider-model-probe-${model.id}`}>
      <div>
        <span className="settings-model-capability-section-label">{t('settings.providers.capability.probe')}</span>
        <p className="settings-section-description">{t(provider.isConfigured
          ? 'settings.providers.capability.probeHint' : 'settings.providers.capability.probeRequiresConnection')}</p>
      </div>
      {modes.length ? <SplitButton variant="secondary" size="sm" disabled={disabled} label={label}
        menuLabel={t('settings.providers.capability.otherChecks')} onClick={() => void runProbe('default')}
        items={modes.map(mode => ({ id: mode, label: t(`settings.providers.capability.probeMode.${mode}`),
          onSelect: () => void runProbe(mode) }))} />
        : <Button variant="secondary" size="sm" disabled={disabled} onClick={() => void runProbe('default')}>{label}</Button>}
    </div>
  );
}
