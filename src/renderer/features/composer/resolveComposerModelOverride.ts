import type { SessionModelOverride } from '@shared/types/session';
import { splitCanonicalAgentModelId } from '@shared/utils/agentModelRoute';
import type { ComposerModelPickerOption } from './composerModelPicker';

export function resolveComposerModelOverride(
  raw: string,
  options: readonly ComposerModelPickerOption[],
): SessionModelOverride | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const canonical = splitCanonicalAgentModelId(trimmed);
  if (canonical) {
    return options.some((option) => (
      option.providerId === canonical.providerId && option.modelId === canonical.modelId
    )) ? canonical : null;
  }
  const matches = options.filter((option) => (
    option.modelId === trimmed || `${option.providerId}:${option.modelId}` === trimmed
  ));
  if (matches.length !== 1) return null;
  return { providerId: matches[0].providerId, modelId: matches[0].modelId };
}
