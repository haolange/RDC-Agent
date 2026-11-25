import { AppError } from '@shared/errors/appError';
import {
  classifyAgentToolEligibility,
  describeAgentToolIneligibility,
  isAgentToolExecutableModel,
} from '@shared/utils/agentToolCapability';
import { loadProviderSurface } from '../provider-catalog/ProviderCatalogRegistry';
import { planEffectiveModelRequest, resolveEffectiveModel } from '../settings/provider-catalog/EffectiveModelResolver';
import { resolveCompactionPercentForProject } from '../settings/settings-core/compactionPercent';
import { settingsService } from '../settings/settings-core/SettingsService';
import type { ConversationTurnControls } from '@shared/types/modelCapability';
import type { SessionModelOverride } from '@shared/types/session';

/** A model a session may run on: in the effective catalog and executable by an Agent with tools. */
export async function assertSessionModelExecutable(model: SessionModelOverride): Promise<void> {
  await loadProviderSurface(model.providerId);
  const effective = resolveEffectiveModel(model.providerId, model.modelId, settingsService.providerConnections);
  if (effective && isAgentToolExecutableModel(effective)) return;
  const eligibility = effective ? classifyAgentToolEligibility(effective) : 'unavailable';
  throw new AppError('MODEL_UNAVAILABLE', eligibility === 'executable'
    ? `${model.providerId}:${model.modelId}`
    : describeAgentToolIneligibility(eligibility, model.providerId, model.modelId).technicalMessage);
}

/** The model is executable and the controls plan into a request for it, as the next turn's preparation will check. */
export async function assertSessionModelAndControls(
  model: SessionModelOverride,
  controls: ConversationTurnControls,
  projectRoot: string | null,
): Promise<void> {
  await assertSessionModelExecutable(model);
  const planning = planEffectiveModelRequest({
    providerId: model.providerId,
    modelId: model.modelId,
    providers: settingsService.providerConnections,
    controls,
    compactionThresholdPercent: resolveCompactionPercentForProject(projectRoot),
  });
  if (!planning.ok) {
    throw new AppError(planning.code === 'CONSTRAINT_REJECTED' ? 'CONSTRAINT_REJECTED' : 'MODEL_UNAVAILABLE', planning.message);
  }
}
