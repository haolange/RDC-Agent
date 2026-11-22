import { Icon, type IconName } from '../../../../ui/Icon';
import type { EffectiveModel } from '@shared/types/providerCapability';
import type { useI18n } from '../../../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];

/** What a model can do, one glyph per supported capability; an unknown or missing capability shows nothing. */
export function ProviderModelCapabilityIcons({ model, t }: { model: EffectiveModel | null; t: Translate }) {
  if (!model) return null;
  const capabilities: Array<{ icon: IconName; label: string; on: boolean }> = [
    { icon: 'tool', label: t('settings.providers.capability.toolCalling'), on: model.toolCalling.state === 'supported' },
    { icon: 'brain', label: t('settings.providers.capability.reasoning'),
      on: model.controls.reasoning.kind !== 'none' && model.controls.reasoning.kind !== 'unknown' },
    { icon: 'lightning', label: t('settings.providers.capability.fastMode'),
      on: model.controls.fast.state === 'selectable' || model.controls.fast.state === 'fixed' },
    { icon: 'image', label: t('settings.providers.capability.visionInput'), on: model.visionInput.state === 'supported' },
    { icon: 'code', label: t('settings.providers.capability.structuredOutput'), on: model.structuredOutput.state === 'supported' },
  ];
  return (
    <span className="settings-model-capability-icons" data-testid={`settings-provider-model-capabilities-${model.modelId}`}>
      {capabilities.filter((capability) => capability.on).map((capability) => (
        <span key={capability.icon} className="settings-model-capability-icon" role="img"
          aria-label={capability.label} data-tooltip={capability.label}>
          <Icon name={capability.icon} size={14} />
        </span>
      ))}
    </span>
  );
}
