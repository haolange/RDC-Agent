import { lookupManagedModelCatalogEntry } from '@shared/constants/modelCapabilityCatalog';
import type { AgentRole } from '@shared/types/agent';
import type { LlmAgentRoute, LlmProviderEntry } from '@shared/types/settings';

export interface ModelUnavailableDetail {
  code: 'MODEL_UNAVAILABLE';
  providerId: string;
  modelId: string;
  recommendedModelIds: string[];
  message: string;
}

export interface ProviderModelAvailabilityResolution {
  modelId: string | null;
  requestedModelId: string;
  remapReason?: string;
  unavailable?: ModelUnavailableDetail;
}

export interface CompatibleRouteResolution {
  route: LlmAgentRoute | null;
  provider: LlmProviderEntry | null;
  requestedModelId?: string;
  remapReason?: string;
  unavailable?: ModelUnavailableDetail;
}

export function isCopilotChatCompletionsUnsupportedModel(modelId: string): boolean {
  const normalized = modelId.toLowerCase();
  return /^gpt-5\.[3-9](?:-|$)/.test(normalized)
    || /^gpt-5\.[0-9]+-codex(?:-|$)/.test(normalized);
}

function isEnabledModel(provider: LlmProviderEntry, modelId: string): boolean {
  return provider.models.some((model) => model.enabled !== false && model.id === modelId);
}

function isRouteCompatible(provider: LlmProviderEntry, modelId: string): boolean {
  return provider.id !== 'github-copilot' || !isCopilotChatCompletionsUnsupportedModel(modelId);
}

function recommendedModels(provider: LlmProviderEntry, requestedModelId: string): string[] {
  const candidates = [...provider.recommendedModels, ...provider.models.map((model) => model.id)];
  return [...new Set(candidates)].filter((modelId) => (
    modelId !== requestedModelId
    && isEnabledModel(provider, modelId)
    && isRouteCompatible(provider, modelId)
  )).slice(0, 5);
}

export function resolveProviderModelAvailability(
  provider: LlmProviderEntry,
  requestedModelId: string,
): ProviderModelAvailabilityResolution {
  if (isEnabledModel(provider, requestedModelId) && isRouteCompatible(provider, requestedModelId)) {
    return { modelId: requestedModelId, requestedModelId };
  }

  const canonical = lookupManagedModelCatalogEntry(provider.id, requestedModelId);
  if (canonical && canonical.id !== requestedModelId
    && isEnabledModel(provider, canonical.id)
    && isRouteCompatible(provider, canonical.id)) {
    return {
      modelId: canonical.id,
      requestedModelId,
      remapReason: `${requestedModelId} is a catalog alias; using canonical model ${canonical.id}.`,
    };
  }

  const recommendedModelIds = recommendedModels(provider, requestedModelId);
  const recommendation = recommendedModelIds.length > 0
    ? ` Available alternatives: ${recommendedModelIds.join(', ')}.`
    : '';
  return {
    modelId: null,
    requestedModelId,
    unavailable: {
      code: 'MODEL_UNAVAILABLE',
      providerId: provider.id,
      modelId: requestedModelId,
      recommendedModelIds,
      message: `MODEL_UNAVAILABLE: ${provider.id}/${requestedModelId} is no longer available.${recommendation}`,
    },
  };
}

export function resolveCompatibleAgentRoute(
  routes: LlmAgentRoute[],
  providers: LlmProviderEntry[],
  agentId: AgentRole,
): CompatibleRouteResolution {
  const route = routes.find((entry) => entry.agentId === agentId) || null;
  if (!route?.providerId || !route.modelId) {
    return { route: null, provider: null };
  }

  const provider = providers.find((entry) => entry.id === route.providerId) || null;
  if (!provider || !provider.enabled || !provider.isConfigured) {
    return { route, provider };
  }

  const resolution = resolveProviderModelAvailability(provider, route.modelId);
  if (!resolution.modelId) {
    return { route, provider, requestedModelId: route.modelId, unavailable: resolution.unavailable };
  }
  if (resolution.modelId === route.modelId) {
    return { route, provider };
  }
  return {
    route: { ...route, modelId: resolution.modelId },
    provider,
    requestedModelId: route.modelId,
    remapReason: resolution.remapReason,
  };
}
