import type { AppSettings } from '@shared/types/settings';
import type { SessionModelOverride } from '@shared/types/session';
import type { EffectiveModel } from '@shared/types/providerCapability';
import { splitCanonicalAgentModelId } from '@shared/utils/agentModelRoute';
import { resolveEffectiveModel } from '../../settings/EffectiveModelResolver';

export function parseSubagentModelArg(raw: unknown): SessionModelOverride {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('MODEL_INVALID: subagent model must be canonical providerId:modelId');
  }
  const parsed = splitCanonicalAgentModelId(raw.trim());
  if (!parsed) {
    throw new Error(`MODEL_INVALID: ${raw}`);
  }
  return parsed;
}

export function assertSubagentModelAvailable(
  model: EffectiveModel | null,
  override: SessionModelOverride,
): EffectiveModel {
  if (
    !model
    || model.enabled === false
    || model.availability !== 'available'
    || model.selection?.pickerVisibility === 'internal'
  ) {
    throw new Error(`MODEL_UNAVAILABLE: ${override.providerId}:${override.modelId}`);
  }
  return model;
}

export function resolveSubagentModelOverride(
  raw: unknown,
  settings: AppSettings,
): SessionModelOverride | undefined {
  if (raw == null || raw === '') return undefined;
  const parsed = parseSubagentModelArg(raw);
  const model = assertSubagentModelAvailable(
    resolveEffectiveModel(parsed.providerId, parsed.modelId, settings),
    parsed,
  );
  return { providerId: model.providerId, modelId: model.modelId };
}
