import type { AgentModelOption } from '@shared/types/agentManifest';
import type { SessionModelOverride } from '@shared/types/session';
import { splitCanonicalAgentModelId } from '@shared/utils/agentModelRoute';

export function isComposerOverrideOption(option: Pick<AgentModelOption, 'status'>): boolean {
  return option.status === 'ready' || option.status === 'model-unverified';
}

export function resolveComposerModelOverride(
  raw: string,
  options: readonly AgentModelOption[],
): SessionModelOverride | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const selectable = options.filter(isComposerOverrideOption);
  const canonical = splitCanonicalAgentModelId(trimmed);
  if (canonical) {
    return selectable.some((option) => (
      option.providerId === canonical.providerId && option.modelId === canonical.modelId
    )) ? canonical : null;
  }
  const matches = selectable.filter((option) => (
    option.modelId === trimmed || option.canonicalId === trimmed
  ));
  if (matches.length !== 1) return null;
  return { providerId: matches[0].providerId, modelId: matches[0].modelId };
}
