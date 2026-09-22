import { getReasoningSelectionOrder, type ReasoningSelection } from '@shared/types/modelCapability';
import { Select } from '../../../../ui/Select';
import { Input } from '../../../../ui/Input';
import { HelpTip } from '../../../../ui/HelpTip';
import { SettingsField } from '../parts';
import { formatReasoningDefault, getReasoningLabelKey } from '../modelCapabilitySummaryUtils';
import { getProviderProtocolLabel } from '../utils';
import type { ProviderModelCapabilitySummaryProps } from './ProviderModelCapabilitySummary';

type Props = Pick<ProviderModelCapabilitySummaryProps, 'model' | 'effectiveModel' | 'snapshot' | 'loading' | 'onModelChange' | 't'>;

export function ProviderModelPreferences({ model, effectiveModel, snapshot, loading, onModelChange, t }: Props) {
  if (!effectiveModel) return null;
  const reasoning = effectiveModel?.controls.reasoning;
  const reasoningUnverified = reasoning?.kind === 'unknown';
  const reasoningDefaultUnverified = reasoningUnverified || reasoning?.defaultState === 'unknown' || reasoning?.defaultState === 'provider-managed';
  const reasoningOptions = reasoningUnverified ? [] : getReasoningSelectionOrder(reasoning);
  const routeOptions = effectiveModel?.routeOptions ?? [];
  const effectiveRouteOption = routeOptions.find((option) => option.routeRevision === effectiveModel?.routeRevision)
    ?? routeOptions.find((option) => option.route.protocol === effectiveModel?.route.protocol);
  const selectedRouteOptionId = model.preferredRouteOptionId
    ?? effectiveModel?.preferredRouteOptionId
    ?? effectiveRouteOption?.id
    ?? routeOptions[0]?.id
    ?? '';

  const updateBudget = (raw: string) => {
    const parsed = Number(raw);
    onModelChange({ defaultBudgetTokens: raw.trim() && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined });
  };
  return <section className="settings-model-preferences" data-testid={`settings-provider-model-preferences-${model.id}`}>
    <div className="settings-model-preferences-heading">
      <span className="settings-model-capability-section-label">{t('settings.providers.capability.preferences')}</span>
      <HelpTip label={t('settings.providers.capability.preferences')}>{t('settings.providers.capability.preferencesHint')}</HelpTip>
    </div>
    <div className="settings-model-preferences-grid">
      <SettingsField label={t('settings.providers.capability.route')} help={t(routeOptions.length > 1 ? 'settings.providers.capability.routeHint' : 'settings.providers.capability.routeReadonlyHint')}>
        {routeOptions.length > 1 ? <Select
          dataTestId={`settings-model-route-${model.id}`} ariaLabel={t('settings.providers.capability.route')}
          value={selectedRouteOptionId} disabled={loading || snapshot?.refreshing}
          onChange={(value) => onModelChange({ preferredRouteOptionId: value || undefined })}
          options={routeOptions.map((option) => ({ value: option.id,
            label: option.label ?? getProviderProtocolLabel(option.route.protocol), disabled: option.availability !== 'available' }))}
        /> : <span className="settings-model-route-readonly">{routeOptions[0]?.label ?? getProviderProtocolLabel(effectiveModel.route.protocol)}</span>}
      </SettingsField>
      <SettingsField label={t('settings.providers.capability.defaultReasoning')}>
        <Select dataTestId={`settings-model-reasoning-${model.id}`} ariaLabel={t('settings.providers.capability.defaultReasoning')}
          value={reasoningDefaultUnverified ? '' : model.defaultReasoningSelection ?? ''} disabled={reasoningOptions.length <= 1}
          onChange={(value) => onModelChange({ defaultReasoningSelection: value ? value as ReasoningSelection : undefined })}
          options={[{ value: '', label: formatReasoningDefault(reasoning ?? null, t) },
            ...reasoningOptions.map((selection) => ({ value: selection, label: t(getReasoningLabelKey(selection)) }))]} />
      </SettingsField>
      <SettingsField label={t('settings.providers.capability.clientBudget')} help={t('settings.providers.capability.clientBudgetHint', { value: effectiveModel.defaultBudgetTokens })}>
        <Input type="number" min={1} step={1000} aria-label={t('settings.providers.capability.clientBudget')}
          value={model.defaultBudgetTokens ?? ''} placeholder={String(effectiveModel.defaultBudgetTokens)}
          onChange={(event) => updateBudget(event.target.value)} />
      </SettingsField>
    </div>
  </section>;
}
