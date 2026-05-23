import type { AgentRole } from '@shared/types/agent';
import type { LlmAgentRoute, LlmProviderEntry } from '@shared/types/settings';

const COPILOT_CHAT_COMPLETIONS_FALLBACK_MODELS = [
  'gemini-3-flash-preview',
  'gemini-3.5-flash',
  'gpt-4.1',
  'gpt-4o',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5',
  'gpt-5-mini',
];

export interface CompatibleRouteResolution {
  route: LlmAgentRoute | null;
  provider: LlmProviderEntry | null;
  requestedModelId?: string;
  remapReason?: string;
}

export function isCopilotChatCompletionsUnsupportedModel(modelId: string): boolean {
  const normalized = modelId.toLowerCase();
  return /^gpt-5\.[3-9](?:-|$)/.test(normalized)
    || /^gpt-5\.[0-9]+-codex(?:-|$)/.test(normalized);
}

function isEnabledModel(provider: LlmProviderEntry, modelId: string): boolean {
  return provider.models.some((model) => model.enabled !== false && model.id === modelId);
}

function resolveCopilotFallbackModel(
  routes: LlmAgentRoute[],
  provider: LlmProviderEntry,
  agentId: AgentRole,
): string | null {
  const debuggerRoute = routes.find((entry) => entry.agentId === 'rdc-debugger');
  const candidates = [
    ...(agentId !== 'rdc-debugger' && debuggerRoute?.providerId === provider.id ? [debuggerRoute.modelId] : []),
    ...COPILOT_CHAT_COMPLETIONS_FALLBACK_MODELS,
    ...provider.models.map((model) => model.id),
  ];

  for (const modelId of candidates) {
    if (modelId && !isCopilotChatCompletionsUnsupportedModel(modelId) && isEnabledModel(provider, modelId)) {
      return modelId;
    }
  }

  return null;
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

  if (!isEnabledModel(provider, route.modelId)) {
    return { route, provider };
  }

  if (provider.id !== 'github-copilot' || !isCopilotChatCompletionsUnsupportedModel(route.modelId)) {
    return { route, provider };
  }

  const fallbackModelId = resolveCopilotFallbackModel(routes, provider, agentId);
  if (!fallbackModelId) {
    return { route, provider };
  }

  return {
    route: {
      ...route,
      modelId: fallbackModelId,
    },
    provider,
    requestedModelId: route.modelId,
    remapReason: `${route.modelId} is not available on GitHub Copilot chat completions; using ${fallbackModelId}.`,
  };
}
