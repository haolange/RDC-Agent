import type { LlmProviderModel } from '@shared/types/settings';
import type { CatalogModelContribution } from './effectiveCatalogTypes';
import { ProviderConnectionError } from './providerConnectionErrors';

export function projectGoogleVertexModelRoutes(
  models: readonly LlmProviderModel[],
  nativeBaseUrl: string,
  openAiBaseUrl: string,
  protocol: 'GoogleVertexGemini' | 'GoogleVertexAnthropic',
): CatalogModelContribution[] {
  return models.map((model): CatalogModelContribution => {
    const nativeRoute = { protocol, baseUrl: nativeBaseUrl, source: 'model' as const };
    const routeOptions = protocol === 'GoogleVertexGemini'
      ? [
          {
            id: 'GoogleVertexGemini',
            route: nativeRoute,
            availability: 'available' as const,
            protocolOwner: 'google',
            endpointOwner: 'google-cloud',
            authMode: 'api-key' as const,
          },
          {
            id: 'OpenAICompatibleChatCompletions',
            route: {
              protocol: 'OpenAICompatibleChatCompletions' as const,
              baseUrl: openAiBaseUrl,
              source: 'model' as const,
            },
            availability: 'available' as const,
            protocolOwner: 'openai',
            endpointOwner: 'google-cloud',
            authMode: 'api-key' as const,
          },
        ]
      : [{
          id: 'GoogleVertexAnthropic',
          route: nativeRoute,
          availability: 'available' as const,
          protocolOwner: 'google',
          endpointOwner: 'google-cloud',
          authMode: 'api-key' as const,
        }];
    return {
      modelId: model.id,
      label: model.label,
      aliases: model.aliases,
      availability: model.availability ?? 'available',
      unavailableReason: model.availabilityReason,
      route: nativeRoute,
      routeOptions,
    };
  });
}

export function resolveBedrockResponsesBaseUrl(chatBaseUrl: string): string {
  const normalized = chatBaseUrl.trim().replace(/\/+$/, '');
  return normalized.endsWith('/openai/v1')
    ? normalized
    : normalized.endsWith('/v1')
      ? `${normalized.slice(0, -3)}/openai/v1`
      : `${normalized}/openai/v1`;
}

export function projectBedrockMantleModelRoutes(
  models: readonly LlmProviderModel[],
  chatBaseUrl: string,
): CatalogModelContribution[] {
  const responsesBaseUrl = resolveBedrockResponsesBaseUrl(chatBaseUrl);
  return models.map((model): CatalogModelContribution => ({
    modelId: model.id,
    label: model.label,
    aliases: model.aliases,
    availability: model.availability ?? 'available',
    unavailableReason: model.availabilityReason,
    route: {
      protocol: 'OpenAICompatibleChatCompletions',
      baseUrl: chatBaseUrl,
      source: 'model',
    },
    routeOptions: [
      {
        id: 'OpenAICompatibleChatCompletions',
        route: {
          protocol: 'OpenAICompatibleChatCompletions',
          baseUrl: chatBaseUrl,
          source: 'model',
        },
        availability: 'available',
        protocolOwner: 'openai',
        endpointOwner: 'aws',
        authMode: 'api-key',
      },
      {
        id: 'OpenAIResponses',
        route: {
          protocol: 'OpenAIResponses',
          baseUrl: responsesBaseUrl,
          source: 'model',
        },
        availability: 'available',
        protocolOwner: 'openai',
        endpointOwner: 'aws',
        authMode: 'api-key',
      },
    ],
  }));
}

/** Volcengine Coding Plan lists models on `/api/coding/v3/models` for both Anthropic and OpenAI bases. */
export const resolveVolcengineCodingPlanModelsUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (/\/api\/coding(?:\/v3)?$/i.test(trimmed)) {
    return `${trimmed.replace(/\/v3$/i, '')}/v3/models`;
  }
  return resolveCodingPlanModelsUrl(trimmed);
};

/** Coding Plan model list: append /v1/models only when the configured base has no /v1. */
export const resolveCodingPlanModelsUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (/\/v1$/i.test(trimmed)) {
    return `${trimmed}/models`;
  }
  return `${trimmed}/v1/models`;
};

/**
 * Cline does not expose OpenAI-style `/models`. Usage lists live at
 * `/ai/cline/models`; ClinePass plan models live at `/ai/cline/recommended-models`.
 */
function resolveClineAppBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  // Host-only origins 404; the live app prefix is `/api/v1`.
  return /^https:\/\/api\.cline\.bot$/i.test(trimmed) ? `${trimmed}/api/v1` : trimmed;
}

export const resolveClineCatalogUrl = (
  baseUrl: string,
  catalog: 'usage' | 'pass',
): string => {
  const trimmed = resolveClineAppBaseUrl(baseUrl);
  return catalog === 'pass'
    ? `${trimmed}/ai/cline/recommended-models`
    : `${trimmed}/ai/cline/models`;
};

/** Account probe for Cline API keys; catalog endpoints do not validate credentials. */
export const resolveClineCredentialProbeUrl = (baseUrl: string): string =>
  `${resolveClineAppBaseUrl(baseUrl)}/users/me`;

export const resolveGoogleVertexOpenAiBaseUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim().replace(/\/+$/u, '');
  const match = trimmed.match(/^(https:\/\/[^/]+)\/v1\/projects\/([^/]+)\/locations\/([^/]+)\/publishers\/google$/u);
  if (!match) {
    if (/\/v1beta1\/projects\/[^/]+\/locations\/[^/]+\/endpoints\/openapi$/u.test(trimmed)) {
      return trimmed;
    }
    throw new ProviderConnectionError('Vertex endpoint does not match a supported publisher or OpenAI-compatible route.');
  }
  const [, origin, project, location] = match;
  return `${origin}/v1beta1/projects/${project}/locations/${location}/endpoints/openapi`;
};

export const resolveGoogleVertexPublisherModelsUrl = (
  baseUrl: string,
  publisher: 'google' | 'anthropic',
): string => {
  const trimmed = baseUrl.trim().replace(/\/+$/u, '');
  const match = trimmed.match(/^(https:\/\/[^/]+)\/v1\/projects\/[^/]+\/locations\/[^/]+\/publishers\/(google|anthropic)$/u);
  if (!match || match[2] !== publisher) {
    throw new ProviderConnectionError(`Vertex ${publisher} endpoint does not match the native publisher route.`);
  }
  return `${match[1]}/v1beta1/publishers/${publisher}/models?pageSize=1000&listAllVersions=true`;
};

export const parseGoogleVertexPublisherModels = (
  payload: unknown,
  publisher: 'google' | 'anthropic',
): LlmProviderModel[] => {
  if (!payload || typeof payload !== 'object') return [];
  const publisherModels = (payload as { publisherModels?: unknown }).publisherModels;
  if (!Array.isArray(publisherModels)) return [];
  const byId = new Map<string, LlmProviderModel>();
  const prefix = `publishers/${publisher}/models/`;
  for (const value of publisherModels) {
    if (!value || typeof value !== 'object') continue;
    const entry = value as {
      name?: unknown;
      versionId?: unknown;
      displayName?: unknown;
      modelDisplayName?: unknown;
    };
    if (typeof entry.name !== 'string' || !entry.name.startsWith(prefix)) continue;
    const baseId = entry.name.slice(prefix.length).trim();
    if (!baseId) continue;
    const versionId = typeof entry.versionId === 'string' ? entry.versionId.trim() : '';
    const id = publisher === 'anthropic' && versionId && !baseId.includes('@')
      ? `${baseId}@${versionId}`
      : baseId;
    const normalized = id.toLowerCase();
    if (publisher === 'google' ? !normalized.includes('gemini') : !normalized.includes('claude')) continue;
    const label = typeof entry.modelDisplayName === 'string' && entry.modelDisplayName.trim()
      ? entry.modelDisplayName.trim()
      : typeof entry.displayName === 'string' && entry.displayName.trim()
        ? entry.displayName.trim()
        : id;
    byId.set(id, {
      id,
      label,
      enabled: true,
      availability: 'unknown',
      availabilityReason: 'Model Garden listing does not confirm access for the configured Google Cloud project.',
    });
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
};
