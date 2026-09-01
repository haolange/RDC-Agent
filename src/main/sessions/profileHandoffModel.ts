import type { AppSettings } from '@shared/types/settings';
import type { SessionModelOverride } from '@shared/types/session';
import { HANDOFF_ERROR } from '@shared/types/profileHandoff';
import { splitCanonicalAgentModelId } from '@shared/utils/agentModelRoute';
import { isAgentToolExecutableModel } from '@shared/utils/agentToolCapability';
import { resolveEffectiveModel } from '../settings/EffectiveModelResolver';

export function isHandoffDeclaredModelValid(canonical: string, settings: AppSettings): boolean {
  const parsed = splitCanonicalAgentModelId(canonical);
  if (!parsed) return false;
  const model = resolveEffectiveModel(parsed.providerId, parsed.modelId, settings);
  return Boolean(model && isAgentToolExecutableModel(model));
}

export function resolveHandoffTurnModelOverride(input: {
  sessionOverride?: SessionModelOverride | null;
  declaredModel: string | null;
  settings: AppSettings;
}): SessionModelOverride | null {
  if (input.sessionOverride) {
    const model = resolveEffectiveModel(
      input.sessionOverride.providerId,
      input.sessionOverride.modelId,
      input.settings,
    );
    if (!model || !isAgentToolExecutableModel(model)) {
      throw new Error(
        `${HANDOFF_ERROR.MODEL_INVALID}: session modelOverride is not an executable Agent model.`,
      );
    }
    return {
      providerId: model.providerId,
      modelId: model.modelId,
    };
  }
  if (input.declaredModel) {
    const parsed = splitCanonicalAgentModelId(input.declaredModel);
    if (!parsed) {
      throw new Error(`${HANDOFF_ERROR.MODEL_INVALID}: declaredModel must be canonical providerId:modelId.`);
    }
    const model = resolveEffectiveModel(parsed.providerId, parsed.modelId, input.settings);
    if (!model || !isAgentToolExecutableModel(model)) {
      throw new Error(`${HANDOFF_ERROR.MODEL_INVALID}: declaredModel is not an executable Agent model.`);
    }
    return {
      providerId: model.providerId,
      modelId: model.modelId,
    };
  }
  return null;
}
