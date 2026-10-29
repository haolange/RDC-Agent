import type { SessionModelOverride } from '@shared/types/session';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { readCompiledComposerRoute, resolveComposerEffectiveModel } from '../../lib/composerEffectiveModel';
import { useComposerModelPickerOptions } from './useComposerModelPickerOptions';

/** A review without an override executes with the declared target's route. */
export function usePlanReviewModelAvailability(override: SessionModelOverride | null | undefined) {
  const settings = useAppSettingsStore((state) => state.settings);
  const { options } = useComposerModelPickerOptions(settings.llm.providers);
  return (agentId: string): boolean => {
    const route = resolveComposerEffectiveModel(override, null, readCompiledComposerRoute(settings, agentId));
    return options.some((option) => option.providerId === route?.providerId && option.modelId === route.modelId);
  };
}
