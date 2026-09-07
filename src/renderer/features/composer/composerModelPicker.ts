import type { EffectiveModel } from '@shared/types/providerCapability';
import { isAgentToolExecutableModel } from '@shared/utils/agentToolCapability';
import { contextTierWindowTokens, resolveContextTierChoices } from '@shared/utils/contextTiers';
import { formatTokenCount } from '@shared/utils/tokens';

export interface ComposerModelPickerOption {
  providerId: string;
  providerLabel: string;
  modelId: string;
  label: string;
  aliases: string[];
  contextWindowTokens: number | null;
  contextWindowLabel: string | null;
  hasReasoning: boolean;
}

export interface ComposerModelPickerGroup {
  providerId: string;
  providerLabel: string;
  models: ComposerModelPickerOption[];
}

export function isComposerPickerModel(model: EffectiveModel): boolean {
  return isAgentToolExecutableModel(model);
}

export function resolvePickerContextWindow(model: EffectiveModel): {
  tokens: number | null;
  label: string | null;
} {
  const choices = resolveContextTierChoices(model);
  const normal = choices.normalTier ? contextTierWindowTokens(choices.normalTier) : undefined;
  const maximum = choices.maxTier ? contextTierWindowTokens(choices.maxTier) : undefined;
  if (normal && maximum && maximum !== normal) {
    return {
      tokens: maximum,
      label: `${formatTokenCount(normal)} → ${formatTokenCount(maximum)}`,
    };
  }
  const tokens = maximum ?? normal ?? null;
  return {
    tokens,
    label: tokens ? formatTokenCount(tokens) : null,
  };
}

export function hasPickerReasoning(model: EffectiveModel): boolean {
  return model.controls.reasoning.kind !== 'none' && model.controls.reasoning.kind !== 'unknown';
}

export function toComposerPickerOption(
  providerId: string,
  providerLabel: string,
  model: EffectiveModel,
): ComposerModelPickerOption {
  const window = resolvePickerContextWindow(model);
  return {
    providerId,
    providerLabel,
    modelId: model.modelId,
    label: model.label || model.modelId,
    aliases: model.aliases,
    contextWindowTokens: window.tokens,
    contextWindowLabel: window.label,
    hasReasoning: hasPickerReasoning(model),
  };
}

export function matchesComposerPickerQuery(
  option: ComposerModelPickerOption,
  query: string,
): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [
    option.providerId,
    option.providerLabel,
    option.modelId,
    option.label,
    ...option.aliases,
  ].some((value) => value.toLowerCase().includes(normalized));
}

export function filterComposerPickerOptions(
  options: ComposerModelPickerOption[],
  query: string,
): ComposerModelPickerOption[] {
  return options.filter((option) => matchesComposerPickerQuery(option, query));
}

export function groupComposerPickerOptions(
  options: ComposerModelPickerOption[],
): ComposerModelPickerGroup[] {
  const groups: ComposerModelPickerGroup[] = [];
  const index = new Map<string, ComposerModelPickerGroup>();
  for (const option of options) {
    const existing = index.get(option.providerId);
    if (existing) {
      existing.models.push(option);
      continue;
    }
    const group: ComposerModelPickerGroup = {
      providerId: option.providerId,
      providerLabel: option.providerLabel,
      models: [option],
    };
    index.set(option.providerId, group);
    groups.push(group);
  }
  return groups;
}
