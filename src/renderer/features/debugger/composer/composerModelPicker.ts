import type { EffectiveModel } from '@shared/types/providerCapability';
import { isEffectiveModelPickerSelectable } from '@shared/utils/effectiveModelPicker';

export interface ComposerModelPickerOption {
  providerId: string;
  providerLabel: string;
  modelId: string;
  label: string;
  aliases: string[];
  contextWindowTokens: number | null;
  hasReasoning: boolean;
}

export interface ComposerModelPickerGroup {
  providerId: string;
  providerLabel: string;
  models: ComposerModelPickerOption[];
}

export function isComposerPickerModel(model: EffectiveModel): boolean {
  return isEffectiveModelPickerSelectable(model);
}

export function resolvePickerContextWindow(model: EffectiveModel): number | null {
  const values = model.contextTiers
    .map((tier) => tier.maxTotalTokens ?? tier.maxPromptTokens)
    .filter((value): value is number => typeof value === 'number' && value > 0);
  return values.length > 0 ? Math.max(...values) : null;
}

export function hasPickerReasoning(model: EffectiveModel): boolean {
  return model.controls.reasoning.kind !== 'none' && model.controls.reasoning.kind !== 'unknown';
}

export function toComposerPickerOption(
  providerId: string,
  providerLabel: string,
  model: EffectiveModel,
): ComposerModelPickerOption {
  return {
    providerId,
    providerLabel,
    modelId: model.modelId,
    label: model.label || model.modelId,
    aliases: model.aliases,
    contextWindowTokens: resolvePickerContextWindow(model),
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
