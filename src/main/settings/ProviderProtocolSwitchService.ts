import type { ConversationTurnControls } from '@shared/types/modelCapability';
import type { EffectiveCatalogSnapshot, EffectiveModel } from '@shared/types/providerCapability';
import type { AppSettings, LlmProviderId, LlmProviderModel, LlmProviderProtocol } from '@shared/types/settings';
import { storageAdapter } from '../sessions/StorageAdapter';
import { effectiveCatalogService } from './EffectiveCatalogService';
import {
  refreshEffectiveCatalogDiscovery,
  selectEffectiveModelFromSnapshot,
} from './EffectiveModelResolver';
import { getProviderPreset } from './ProviderPresetRegistry';
import { planModelRequest } from './RequestPlanner';

export class ProtocolProjectionError extends Error {
  readonly code = 'PROTOCOL_REPROJECTION_FAILED';
}

export function clampControlsForProtocolModels(
  controls: ConversationTurnControls,
  models: EffectiveModel[],
): ConversationTurnControls {
  let next = { ...controls };
  for (const model of models) {
    const planning = planModelRequest({ model, controls: next });
    if (!planning.ok) {
      throw new ProtocolProjectionError(`${model.providerId}/${model.modelId}: ${planning.code}: ${planning.message}`);
    }
    next = planning.controls;
  }
  return next;
}

export function resolveProtocolRouteModels(
  settings: AppSettings,
  snapshot: EffectiveCatalogSnapshot,
  providerId: string,
): EffectiveModel[] {
  const recommended = getProviderPreset(providerId)?.recommendedModels ?? [];
  const selections = settings.llm.agentRoutes
    .filter((route) => route.providerId === providerId)
    .map((route) => selectEffectiveModelFromSnapshot(snapshot, route.modelId, recommended));
  const missing = selections.filter((selection) => !selection.model);
  if (missing.length > 0) {
    const detail = missing.map((selection) => {
      const recommendations = selection.recommendations.map((entry) => entry.modelId).join(', ');
      return `${providerId}/${selection.requestedModelId}${recommendations ? ` (recommended: ${recommendations})` : ''}`;
    }).join('; ');
    throw new ProtocolProjectionError(`MODEL_UNAVAILABLE after protocol reprojection: ${detail}.`);
  }
  return [...new Map(selections.map((selection) => [
    selection.model!.modelId,
    selection.model!,
  ])).values()];
}

export async function reprojectProviderProtocolChange(input: {
  providerId: LlmProviderId;
  previousProtocol: LlmProviderProtocol;
  settings: AppSettings;
  discoveredModels?: LlmProviderModel[];
  snapshot?: EffectiveCatalogSnapshot;
}): Promise<EffectiveCatalogSnapshot> {
  const provider = input.settings.llm.providers.find((entry) => entry.id === input.providerId);
  if (!provider) throw new ProtocolProjectionError(`Provider ${input.providerId} no longer exists.`);
  if (!input.snapshot && !input.discoveredModels) {
    throw new ProtocolProjectionError('Protocol changes require successful discovery through the provider connection flow.');
  }
  const accountId = provider.activeAccountId ?? `anonymous:${provider.id}`;
  effectiveCatalogService.invalidateDiscovery({ providerId: provider.id, accountId, protocol: input.previousProtocol });
  const snapshot = input.snapshot ?? await refreshEffectiveCatalogDiscovery(provider, input.discoveredModels!);
  if (snapshot.providerId !== provider.id || snapshot.accountId !== accountId || snapshot.protocol !== provider.protocol) {
    throw new ProtocolProjectionError('Protocol reprojection received a catalog snapshot for a different provider, account, or protocol.');
  }
  const routedModels = resolveProtocolRouteModels(input.settings, snapshot, provider.id);

  for (const project of storageAdapter.listProjects()) {
    for (const session of storageAdapter.listSessions(project.projectId)) {
      if (!session.turnControls) continue;
      const clamped = clampControlsForProtocolModels(session.turnControls, routedModels);
      if (JSON.stringify(clamped) !== JSON.stringify(session.turnControls)) {
        storageAdapter.updateSession(session.sessionId, { turnControls: clamped });
      }
    }
  }
  return snapshot;
}
