import {
  getProviderAuthModeAvailability,
  getProviderCatalogOwnership,
  getProviderDefaultBaseUrl,
  getProviderModelDefinitions,
  getProviderModelSummaries,
  isBuiltinProviderId,
  loadProviderSurface,
} from '../provider-catalog/ProviderCatalogRegistry';
import type {
  LlmProviderAccountLoginFinishRequest,
  LlmProviderAccountLoginStartRequest,
  LlmProviderAccountStatus,
  LlmProviderAuthMode,
  LlmProviderConnectionResult,
  LlmProviderDraftRequest,
  LlmProviderEntry,
  LlmProviderId,
  LlmProviderModel,
} from '@shared/types/settings';
import type { ProviderSurfaceDefinition } from '@shared/types/providerCapability';
import { settingsService } from '../settings/SettingsService';
import { providerAccountAuthService } from './ProviderAccountAuthService';
import { extractDiscoveredModelIdentity, isAdmittedDiscoveredModel } from './DiscoveryAdmission';
import {
  parseDeclarativeCatalog,
  resolveDeclarativeDiscoveryUrl,
  toDeclarativeCatalogContributions,
} from './DeclarativeCatalogDiscovery';
import type {
  CatalogModelContribution,
  DiscoveryLoader,
  EffectiveCatalogRequest,
} from './EffectiveCatalogService';
import {
  applyDiscoveryAuthority,
  refreshEffectiveCatalogDiscovery,
  toDiscoveryModelContributions,
} from './EffectiveModelResolver';
import { parseClineCatalog, parseFreeModelCatalog, parseOpenCodeGoCatalog } from './LiveProviderCatalogParsers';
import {
  isProviderConnectionSchemaSatisfied,
  resolveProviderConnectionHeaders,
  resolvePrimaryConnectionSecretFieldId,
  resolveProviderEndpointTemplate,
} from './ProviderConnectionSchema';
import { resolveGoogleVertexAccessToken } from './GoogleApplicationCredentials';
import { createAwsBedrockRequestAuthorizer } from './AwsBedrockCredentials';
import { listSapAiCoreDeployments } from './SapAiCoreCredentials';

const REQUEST_TIMEOUT_MS = 20000;

interface ModelDiscoveryResult {
  models: LlmProviderModel[];
  contributions?: CatalogModelContribution[];
  entitlementContributions?: CatalogModelContribution[];
  discoveryDiagnostic?: LlmProviderConnectionResult['discoveryDiagnostic'];
}

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

type ProviderDiscoveryStrategy =
  | 'openai-compatible'
  | 'anthropic-candidate-validation'
  | 'google-ai-studio'
  | 'azure-deployment'
  | 'google-vertex-models'
  | 'ollama-tags'
  | 'opencode-go-catalog'
  | 'cline-catalog'
  | 'freemodel-catalog'
  | 'gitlab-duo-direct-access'
  | 'sap-ai-core-deployments';

function resolveDiscoveryStrategy(
  protocol: LlmProviderEntry['protocol'],
  discovery: ProviderSurfaceDefinition['discovery']['strategy'],
): ProviderDiscoveryStrategy | null {
  if (!discovery) return null;
  const parserId = discovery.kind === 'custom-parser' ? discovery.parserId : undefined;
  if (parserId === 'opencode-go-catalog' || parserId === 'cline-catalog' || parserId === 'google-vertex-models'
    || parserId === 'gitlab-duo-direct-access' || parserId === 'sap-ai-core-deployments') return parserId;
  if (parserId === 'freemodel-catalog') return parserId;
  if (parserId === 'google-ai-studio' || parserId === 'azure-deployment' || parserId === 'ollama-tags') return parserId;
  if (parserId === 'anthropic' || parserId === 'anthropic-candidate-validation') return 'anthropic-candidate-validation';
  if (parserId === 'openai-compatible') return 'openai-compatible';
  if (protocol === 'OpenAICompatibleChatCompletions' || protocol === 'OpenAIResponses' || protocol === 'OpenRouterChatCompletions') {
    return 'openai-compatible';
  }
  if (protocol === 'AnthropicMessages') {
    return 'anthropic-candidate-validation';
  }
  if (protocol === 'OllamaOpenAICompatibleChatCompletions') {
    return 'ollama-tags';
  }
  return null;
}

export function normalizeDiscoveredModels(
  values: unknown[],
  filterModelId: (modelId: string) => boolean = () => true,
): LlmProviderModel[] {
  const models = new Map<string, LlmProviderModel>();
  for (const value of values) {
    const identity = extractDiscoveredModelIdentity(value);
    const id = identity.id;
    if (!isAdmittedDiscoveredModel(value) || isDeprecatedModel(id) || !filterModelId(id)) {
      continue;
    }
    const label = value && typeof value === 'object' && typeof (value as { display_name?: unknown }).display_name === 'string'
      ? ((value as { display_name: string }).display_name.trim() || id)
      : id;
    const existing = models.get(id);
    const aliases = [...new Set([...(existing?.aliases ?? []), ...identity.aliases])];
    models.set(id, existing
      ? { ...existing, ...(aliases.length > 0 ? { aliases } : {}) }
      : { id, label, enabled: true, ...(aliases.length > 0 ? { aliases } : {}) });
  }
  return Array.from(models.values()).sort((left, right) => left.id.localeCompare(right.id));
}

export function parseProviderError(error: unknown): string {
  if (error instanceof ProviderConnectionError) {
    return error.message;
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return '连接测试超时，请稍后重试';
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return '连接测试失败';
}

class ProviderConnectionError extends Error {}

const isDeprecatedModel = (modelId: string): boolean => {
  const normalized = modelId.toLowerCase();
  return (
    normalized.includes('deprecated')
    || normalized.startsWith('gpt-3.5')
    || normalized.startsWith('claude-2')
    || normalized.startsWith('claude-instant')
  );
};

const isAgentRoutableOpenAiModel = (modelId: string): boolean => isAdmittedDiscoveredModel(modelId);

const requireModels = (models: LlmProviderModel[]): LlmProviderModel[] => {
  if (models.length === 0) {
    throw new ProviderConnectionError('Provider 暂未返回可用于 Agent 路由的模型');
  }
  return models;
};

const toStaticModels = (modelIds: string[]): LlmProviderModel[] => requireModels(
  normalizeDiscoveredModels(modelIds),
);

const requireManagedModels = (providerId: string): LlmProviderModel[] => {
  const models = getProviderModelSummaries(providerId);
  if (models.length === 0) {
    throw new ProviderConnectionError('Provider is missing an app-managed model catalog.');
  }
  return models;
};

/**
 * Volcengine Coding Plan `/models` often returns date-suffixed or vendor-prefixed ids
 * (`doubao-seed-2-0-code-preview-260215`, `volcengine/doubao-seed-2-0-pro-260215`)
 * while the product/docs use friendly ids (`doubao-seed-2.0-code`). Normalize both
 * sides for matching. Also collapses known product synonyms (mini ↔ lite).
 */
export const normalizeCodingPlanModelMatchKey = (modelId: string): string => {
  let normalized = modelId.trim().toLowerCase();
  // Strip vendor / namespace prefixes used by some clients and list payloads.
  normalized = normalized.replace(/^[^/\s]+\/+/, '');
  // Strip preview + 6–8 digit date suffixes: -260215, -preview-260215, -20260215.
  normalized = normalized.replace(/(?:-preview)?-\d{6,8}$/i, '');
  normalized = normalized.replace(/\./g, '-');
  // Product synonym: Seed 2.0 "mini" list ids map to the catalog "lite" routing id.
  if (normalized === 'doubao-seed-2-0-mini') {
    return 'doubao-seed-2-0-lite';
  }
  return normalized;
};

const isCodingPlanMetaModelId = (modelId: string): boolean => {
  const normalized = modelId.trim().toLowerCase().replace(/^[^/\s]+\/+/, '');
  return normalized === 'ark-code-latest'
    || normalized.endsWith('-latest')
    || normalized.startsWith('ark-code-');
};

const isConcreteCodingPlanDiscovery = (model: LlmProviderModel): boolean => (
  !isCodingPlanMetaModelId(model.id)
);

export const mergeManagedModelAvailability = (
  managedModels: LlmProviderModel[],
  discoveredModels: LlmProviderModel[],
  options?: {
    aliasesByModelId?: ReadonlyMap<string, readonly string[]>;
    preserveMissing?: boolean;
  },
): LlmProviderModel[] => {
  if (discoveredModels.length === 0) {
    return managedModels;
  }
  const discoveredKeys = new Set(
    discoveredModels.flatMap((model) => [
      model.id.toLowerCase(),
      normalizeCodingPlanModelMatchKey(model.id),
    ]),
  );
  const isDiscovered = (modelId: string, aliases?: readonly string[]): boolean => {
    const candidates = [modelId, ...(aliases ?? [])];
    return candidates.some((candidate) => (
      discoveredKeys.has(candidate.toLowerCase())
      || discoveredKeys.has(normalizeCodingPlanModelMatchKey(candidate))
    ));
  };
  const concreteDiscovery = discoveredModels.filter(isConcreteCodingPlanDiscovery);
  const metaOnlyDiscovery = concreteDiscovery.length === 0;
  const discoveredSample = discoveredModels
    .slice(0, 8)
    .map((model) => model.id)
    .join(', ');

  const merged = managedModels.map((model) => {
    const aliases = options?.aliasesByModelId?.get(model.id);
    const available = isDiscovered(model.id, aliases);
    if (available) {
      return {
        ...model,
        enabled: true,
        availability: 'available' as const,
        availabilityReason: undefined,
      };
    }
    if (options?.preserveMissing) {
      return model;
    }
    return {
      ...model,
      enabled: false,
      availability: 'unavailable' as const,
      availabilityReason: metaOnlyDiscovery
        ? `Endpoint returned only meta model ids (${discoveredSample || 'ark-code-latest'}). Coding Plan chat still accepts catalog model ids after a successful connection test.`
        : `This catalog model was not returned by the current account or endpoint${discoveredSample ? ` (endpoint sample: ${discoveredSample})` : ''}.`,
    };
  });

  return merged;
};

export const selectSupportedCodingPlanModels = (
  providerId: string,
  models: LlmProviderModel[],
): LlmProviderModel[] => (
  providerId === 'volcengine-coding-plan'
    ? models.filter((model) => model.enabled !== false && model.availability === 'available')
    : models
);

const buildManagedAliasIndex = (providerId: string): Map<string, readonly string[]> => {
  const map = new Map<string, readonly string[]>();
  for (const entry of getProviderModelDefinitions(providerId)) {
    map.set(entry.modelId, entry.aliases ?? []);
  }
  return map;
};

/** Volcengine Coding Plan lists models on `/api/coding/v3/models` for both Anthropic and OpenAI bases. */
export const resolveVolcengineCodingPlanModelsUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (/\/api\/coding(?:\/v3)?$/i.test(trimmed)) {
    return `${trimmed.replace(/\/v3$/i, '')}/v3/models`;
  }
  return resolveCodingPlanModelsUrl(trimmed);
};

/** Coding Plan models list: align with CodePilot — append `/v1/models` when base has no `/v1`. */
export const resolveCodingPlanModelsUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (/\/v1$/i.test(trimmed)) {
    return `${trimmed}/models`;
  }
  return `${trimmed}/v1/models`;
};

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

const getJson = async (url: string, init: RequestInit): Promise<unknown> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ProviderConnectionError(formatHttpError(response.status));
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
};

const formatHttpError = (status: number): string => {
  if (status === 401 || status === 403) {
    return 'API Key 无效或权限不足';
  }
  if (status === 404) {
    return '模型发现端点不可用';
  }
  if (status >= 500) {
    return 'Provider 服务暂时不可用';
  }
  return `连接测试失败（HTTP ${status}）`;
};

const appendPath = (baseUrl: string, path: string): string =>
  `${baseUrl.trim().replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;

const appendQueryParam = (url: string, key: string, value: string): string => {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
};

const parseModelsPayload = (strategy: ProviderDiscoveryStrategy, payload: unknown): LlmProviderModel[] => {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  const record = payload as {
    data?: unknown;
    models?: unknown;
  };
  if (strategy === 'ollama-tags') {
    return Array.isArray(record.models) ? normalizeDiscoveredModels(record.models) : [];
  }
  if (strategy === 'google-ai-studio') {
    const googleModels = Array.isArray(record.models) ? record.models : [];
    return normalizeDiscoveredModels(
      googleModels
        .filter((value) => {
          const methods = value && typeof value === 'object'
            ? (value as { supportedGenerationMethods?: unknown }).supportedGenerationMethods
            : null;
          return !Array.isArray(methods) || methods.includes('generateContent');
        })
        .map((value) => {
          if (value && typeof value === 'object' && typeof (value as { name?: unknown }).name === 'string') {
            return {
              ...(value as Record<string, unknown>),
              id: (value as { name: string }).name.replace(/^models\//, ''),
            };
          }
          return value;
        }),
      isAgentRoutableOpenAiModel,
    );
  }
  return Array.isArray(record.data)
    ? normalizeDiscoveredModels(record.data, isAgentRoutableOpenAiModel)
    : [];
};

const createTinyAnthropicProbeBody = (modelId: string): string => JSON.stringify({
  model: modelId,
  max_tokens: 1,
  messages: [{ role: 'user', content: 'ping' }],
});

const createTinyOpenAiProbeBody = (modelId: string): string => JSON.stringify({
  model: modelId,
  max_tokens: 1,
  messages: [{ role: 'user', content: 'ping' }],
});

interface ResolvedProviderConnectionDraft {
  apiKey: string;
  baseUrl: string;
  values: Record<string, string>;
}

export function resolveProviderConnectionDraft(
  provider: LlmProviderEntry,
  request: Pick<LlmProviderDraftRequest, 'apiKey' | 'baseUrl' | 'connectionValues'>,
  storedValues: Readonly<Record<string, string>> = {},
): ResolvedProviderConnectionDraft {
  const primarySecretFieldId = resolvePrimaryConnectionSecretFieldId(provider.connectionSchema);
  const values: Record<string, string> = {
    ...storedValues,
    ...(request.connectionValues ?? {}),
  };
  const apiKeyDraft = request.apiKey?.trim() ?? '';
  if (apiKeyDraft && primarySecretFieldId) {
    values[primarySecretFieldId] = apiKeyDraft;
  }
  const apiKey = primarySecretFieldId
    ? values[primarySecretFieldId]?.trim() ?? ''
    : apiKeyDraft;
  if (provider.authMode === 'api-key') {
    const schemaSatisfied = provider.connectionSchema?.fields.length
      ? isProviderConnectionSchemaSatisfied(provider.connectionSchema, values)
      : Boolean(apiKey);
    const supportsCredentialResolver = provider.id === 'google-vertex'
      || provider.id === 'google-vertex-anthropic'
      || provider.id === 'amazon-bedrock';
    if (!schemaSatisfied || (!apiKey && !supportsCredentialResolver)) {
      throw new ProviderConnectionError('Provider connection fields are incomplete.');
    }
  }
  const baseUrl = resolveProviderEndpointTemplate(
    provider.connectionSchema,
    values,
    request.baseUrl ?? '',
    provider.baseUrl ?? '',
  );
  return { apiKey, baseUrl, values };
}

export class ProviderConnectionService {
  constructor() {
    providerAccountAuthService.setCatalogPublisher(async (providerId, discovery) => {
      const provider = settingsService.getAll().llm.providers.find((entry) => entry.id === providerId);
      if (provider) {
        await refreshEffectiveCatalogDiscovery(
          provider,
          discovery.models,
          discovery.contributions,
          discovery.entitlementContributions,
          discovery.detail,
        );
      }
    });
  }

  createEffectiveCatalogDiscoveryLoader(request: EffectiveCatalogRequest): DiscoveryLoader | undefined {
    const provider = settingsService.getAll().llm.providers.find((entry) => entry.id === request.providerId);
    const accountId = provider?.activeAccountId ?? (provider ? `anonymous:${provider.id}` : '');
    if (
      !provider
      || !provider.isConfigured
      || provider.protocol !== request.protocol
      || accountId !== request.accountId
    ) {
      return undefined;
    }
    return async () => {
      const connection = provider.authMode === 'account'
        ? null
        : resolveProviderConnectionDraft(
            provider,
            {},
            settingsService.getProviderConnectionValues(provider.id),
          );
      const discovery = provider.authMode === 'account'
        ? await providerAccountAuthService.loadEffectiveCatalog(provider.id)
        : await this.discoverModels(provider, connection?.apiKey ?? '', connection?.baseUrl ?? '', connection?.values ?? {});
      return {
        protocol: provider.protocol,
        ...('detail' in discovery && discovery.detail ? { detail: discovery.detail } : {}),
        models: applyDiscoveryAuthority(
          provider,
          discovery.contributions ?? toDiscoveryModelContributions(discovery.models),
        ),
        ...(discovery.entitlementContributions?.length
          ? {
              entitlement: {
                protocol: provider.protocol,
                detail: 'Account catalog entitlement groups',
                models: discovery.entitlementContributions,
              },
            }
          : {}),
      };
    };
  }

  async testProviderDraft(request: LlmProviderDraftRequest): Promise<LlmProviderConnectionResult> {
    try {
      const provider = this.requireDefaultConnectionProtocol(
        this.resolveProviderAuthMode(this.getProvider(request.providerId), request.authMode),
        request.protocol,
      );
      const connection = resolveProviderConnectionDraft(
        provider,
        request,
        settingsService.getProviderConnectionValues(provider.id),
      );
      const discovery = await this.discoverModels(
        provider,
        connection.apiKey,
        connection.baseUrl,
        connection.values,
      );
      return {
        success: true,
        provider,
        ...discovery,
      };
    } catch (error) {
      return {
        success: false,
        models: [],
        error: parseProviderError(error),
      };
    }
  }

  async connectProvider(request: LlmProviderDraftRequest): Promise<LlmProviderConnectionResult> {
    try {
      const provider = this.requireDefaultConnectionProtocol(
        this.resolveProviderAuthMode(this.getProvider(request.providerId), request.authMode),
        request.protocol,
      );
      const connection = resolveProviderConnectionDraft(
        provider,
        request,
        settingsService.getProviderConnectionValues(provider.id),
      );
      const { apiKey, baseUrl } = connection;
      const discovery = await this.discoverModels(provider, apiKey, baseUrl, connection.values);
      const { models } = discovery;
      const nextSettings = settingsService.saveProviderConnection(
        provider.id,
        apiKey,
        models,
        baseUrl,
        provider.protocol,
        provider.authMode,
        request.modelPreferences,
        request.connectionValues,
      );
      const nextProvider = nextSettings.llm.providers.find((entry) => entry.id === provider.id);
      if (nextProvider) {
        await refreshEffectiveCatalogDiscovery(
          nextProvider,
          models,
          discovery.contributions,
          discovery.entitlementContributions,
        );
      }
      return {
        success: true,
        provider: nextProvider,
        ...discovery,
      };
    } catch (error) {
      return {
        success: false,
        models: [],
        error: parseProviderError(error),
      };
    }
  }

  async refreshProviderModels(providerId: LlmProviderId): Promise<LlmProviderConnectionResult> {
    try {
      const provider = this.getProvider(providerId);
      if (provider.authMode === 'account') {
        const status = await providerAccountAuthService.test(provider.id);
        if (!status.connected) {
          throw new ProviderConnectionError(status.error || status.message || 'Account provider is not connected');
        }
        const nextProvider = settingsService.getAll().llm.providers.find((entry) => entry.id === provider.id);
        return {
          success: true,
          provider: nextProvider,
          models: nextProvider?.models ?? [],
        };
      }
      const connection = resolveProviderConnectionDraft(
        provider,
        {},
        settingsService.getProviderConnectionValues(provider.id),
      );
      const discovery = await this.discoverModels(provider, connection.apiKey, connection.baseUrl, connection.values);
      const { models } = discovery;
      const nextSettings = settingsService.saveProviderConnection(
        provider.id,
        '',
        models,
        connection.baseUrl,
        provider.protocol,
        provider.authMode,
      );
      const nextProvider = nextSettings.llm.providers.find((entry) => entry.id === provider.id);
      if (nextProvider) {
        await refreshEffectiveCatalogDiscovery(
          nextProvider,
          models,
          discovery.contributions,
          discovery.entitlementContributions,
        );
      }
      return {
        success: true,
        provider: nextProvider,
        ...discovery,
      };
    } catch (error) {
      return {
        success: false,
        models: [],
        error: parseProviderError(error),
      };
    }
  }

  disconnectProvider(providerId: LlmProviderId): LlmProviderConnectionResult {
    try {
      const nextSettings = settingsService.disconnectProvider(providerId);
      const provider = nextSettings.llm.providers.find((entry) => entry.id === providerId);
      return {
        success: true,
        provider,
        models: provider?.models ?? [],
      };
    } catch (error) {
      return {
        success: false,
        models: [],
        error: parseProviderError(error),
      };
    }
  }

  startProviderAccountLogin(request: LlmProviderAccountLoginStartRequest): Promise<LlmProviderAccountStatus> {
    const provider = this.resolveProviderAuthMode(this.getProvider(request.providerId), request.authMode ?? 'account');
    const availability = provider.authModeAvailability?.account;
    if (provider.authMode !== 'account' || !provider.authModeOptions?.includes('account')) {
      return Promise.resolve({
        providerId: request.providerId,
        state: 'unavailable',
        available: false,
        connected: false,
        error: 'Provider does not support account login.',
      });
    }
    if (availability?.state === 'unavailable' || !provider.accountLoginConfigured) {
      return Promise.resolve({
        providerId: request.providerId,
        state: 'unavailable',
        available: false,
        connected: false,
        error: availability?.reason ?? 'Provider account login is not configured.',
      });
    }
    return providerAccountAuthService.startLogin({ ...request, authMode: 'account' });
  }

  finishProviderAccountLogin(request: LlmProviderAccountLoginFinishRequest): Promise<LlmProviderAccountStatus> {
    return providerAccountAuthService.finishLogin(request);
  }

  getProviderAccountStatus(providerId: LlmProviderId): LlmProviderAccountStatus {
    return providerAccountAuthService.status(providerId);
  }

  logoutProviderAccount(providerId: LlmProviderId): LlmProviderAccountStatus {
    return providerAccountAuthService.logout(providerId);
  }

  private getProvider(providerId: LlmProviderId): LlmProviderEntry {
    const provider = settingsService.getAll().llm.providers.find((entry) => entry.id === providerId);
    if (!provider || !isBuiltinProviderId(provider.id)) {
      throw new ProviderConnectionError('未知 Provider');
    }
    return provider;
  }

  private requireDefaultConnectionProtocol(provider: LlmProviderEntry, protocolDraft: unknown): LlmProviderEntry {
    if (protocolDraft !== undefined && protocolDraft !== provider.protocol) {
      throw new ProviderConnectionError(
        `Provider-level protocol switching is unsupported for ${provider.id}; choose a route on each model.`,
      );
    }
    return provider;
  }

  private resolveProviderAuthMode(
    provider: LlmProviderEntry,
    authModeDraft: LlmProviderAuthMode | undefined,
  ): LlmProviderEntry {
    const authMode = authModeDraft ?? provider.authMode;
    const options = provider.authModeOptions ?? [provider.authMode];
    if (!options.includes(authMode)) {
      throw new ProviderConnectionError(`Provider ${provider.id} does not support ${authMode} authentication.`);
    }
    const availability = getProviderAuthModeAvailability(provider.id)[authMode]
      ?? provider.authModeAvailability?.[authMode]
      ?? provider.providerAvailability;
    return {
      ...provider,
      authMode,
      activeAccountId: provider.authAccountIds?.[authMode],
      hasStoredSecret: provider.hasStoredSecretByAuthMode?.[authMode] === true,
      unavailableReason: availability.state === 'unavailable' ? availability.reason : undefined,
    };
  }

  private async discoverModels(
    provider: LlmProviderEntry,
    apiKeyDraft: string,
    baseUrlDraft: string,
    connectionValues: Readonly<Record<string, string>> = {},
  ): Promise<ModelDiscoveryResult> {
    if (provider.authMode === 'account') {
      throw new ProviderConnectionError('Account providers must be tested through the account login flow.');
    }
    const definition = await loadProviderSurface(provider.id);
    const catalogOwnership = getProviderCatalogOwnership(provider.id);
    const managedModels = catalogOwnership !== 'user-managed'
      ? requireManagedModels(provider.id)
      : [];
    if (provider.unavailableReason) {
      throw new ProviderConnectionError(provider.unavailableReason);
    }
    if (!definition) {
      throw new ProviderConnectionError('Provider 不在内置 catalog 中');
    }
    const hasCredentialResolver = provider.id === 'google-vertex'
      || provider.id === 'google-vertex-anthropic'
      || provider.id === 'amazon-bedrock';
    const apiKey = provider.authMode === 'api-key'
      ? (provider.id === 'google-vertex' || provider.id === 'google-vertex-anthropic') && !apiKeyDraft
        ? await resolveGoogleVertexAccessToken(connectionValues.GOOGLE_APPLICATION_CREDENTIALS)
        : apiKeyDraft
      : '';
    if (provider.authMode === 'api-key' && !apiKey && !hasCredentialResolver) {
      throw new ProviderConnectionError('请输入 API Key');
    }

    const strategy = resolveDiscoveryStrategy(provider.protocol, definition.discovery.strategy);
    if (!strategy) {
      if (catalogOwnership !== 'user-managed') {
        return { models: managedModels };
      }
      throw new ProviderConnectionError('Provider 缺少模型发现配置');
    }
    const baseUrl = (
      baseUrlDraft
      || provider.baseUrl
      || getProviderDefaultBaseUrl(provider.id)
      || ''
    ).trim().replace(/\/+$/, '');
    if (!baseUrl) {
      throw new ProviderConnectionError('请填写 Provider Base URL');
    }
    if (provider.id === 'amazon-bedrock') {
      const url = appendPath(baseUrl, '/models');
      const unsignedHeaders = { Accept: 'application/json' };
      const headers = apiKey
        ? { ...unsignedHeaders, Authorization: `Bearer ${apiKey}` }
        : await createAwsBedrockRequestAuthorizer(connectionValues)({
            url,
            method: 'GET',
            headers: unsignedHeaders,
            body: '',
          });
      const payload = await getJson(url, { method: 'GET', headers });
      const models = requireModels(parseModelsPayload('openai-compatible', payload));
      return { models, contributions: projectBedrockMantleModelRoutes(models, baseUrl) };
    }
    if (strategy === 'gitlab-duo-direct-access') {
      const { GitLabDirectAccessClient } = await import('gitlab-ai-provider');
      const client = new GitLabDirectAccessClient({
        instanceUrl: baseUrl,
        getHeaders: () => ({
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'RDC-Agent/1.0',
        }),
        featureFlags: {
          duo_agent_platform_agentic_chat: true,
          duo_agent_platform: true,
        },
      });
      await client.getDirectAccessToken();
      return { models: managedModels };
    }
    if (strategy === 'sap-ai-core-deployments') {
      const deployments = await listSapAiCoreDeployments({
        serviceKeyJson: apiKey,
        configuredApiUrl: baseUrl,
        resourceGroup: connectionValues.AICORE_RESOURCE_GROUP,
        scenarioId: provider.protocol === 'SapAiCoreFoundationModels' ? 'foundation-models' : 'orchestration',
      });
      const requestedDeploymentId = connectionValues.AICORE_DEPLOYMENT_ID?.trim();
      const admitted = requestedDeploymentId
        ? deployments.some((deployment) => deployment.id === requestedDeploymentId)
        : deployments.length > 0;
      if (!admitted) {
        throw new ProviderConnectionError(requestedDeploymentId
          ? `SAP AI Core deployment ${requestedDeploymentId} is not RUNNING for this route.`
          : 'SAP AI Core returned no RUNNING deployment for this route.');
      }
      return { models: managedModels };
    }
    const candidateModelIds = catalogOwnership !== 'user-managed'
      ? managedModels.map((model) => model.id)
      : provider.recommendedModels;
    if (strategy === 'opencode-go-catalog' || strategy === 'cline-catalog') {
      const payload = await getJson(appendPath(baseUrl, '/models'), {
        method: 'GET',
        headers: this.createHeaders(provider, apiKey, connectionValues),
      });
      const parsed = strategy === 'opencode-go-catalog'
        ? parseOpenCodeGoCatalog(payload)
        : parseClineCatalog(payload);
      return {
        models: requireModels(parsed.models),
        contributions: parsed.contributions,
        entitlementContributions: parsed.entitlementContributions,
      };
    }
    if (strategy === 'freemodel-catalog') {
      const [openAiPayload, claudePayload] = await Promise.all([
        getJson('https://api.freemodel.dev/v1/models', {
          method: 'GET',
          headers: this.createHeaders(provider, apiKey, connectionValues),
        }),
        getJson('https://cc.freemodel.dev/v1/models', {
          method: 'GET',
          headers: this.createHeaders(provider, apiKey, connectionValues),
        }),
      ]);
      const parsed = parseFreeModelCatalog(openAiPayload, claudePayload);
      return {
        models: requireModels(parsed.models),
        contributions: parsed.contributions,
      };
    }
    if (strategy === 'google-vertex-models') {
      if (provider.protocol === 'GoogleVertexAnthropic') {
        const payload = await getJson(resolveGoogleVertexPublisherModelsUrl(baseUrl, 'anthropic'), {
          method: 'GET',
          headers: this.createHeaders(provider, apiKey, connectionValues),
        });
        const admitted = requireModels(parseGoogleVertexPublisherModels(payload, 'anthropic'));
        return {
          models: admitted,
          contributions: projectGoogleVertexModelRoutes(
            admitted,
            baseUrl,
            '',
            'GoogleVertexAnthropic',
          ),
        };
      }
      const modelsBaseUrl = resolveGoogleVertexOpenAiBaseUrl(baseUrl);
      const payload = await getJson(appendPath(modelsBaseUrl, '/models'), {
        method: 'GET',
        headers: this.createHeaders(provider, apiKey, connectionValues),
      });
      const discovered = parseModelsPayload('openai-compatible', payload);
      const models = provider.protocol === 'GoogleVertexGemini'
        ? discovered.filter((model) => model.id.toLowerCase().includes('gemini'))
        : discovered;
      const admitted = requireModels(models);
      return {
        models: admitted,
        contributions: projectGoogleVertexModelRoutes(
          admitted,
          baseUrl,
          modelsBaseUrl,
          'GoogleVertexGemini',
        ),
      };
    }
    const surfaceDiscoveryStrategy = definition.discovery.strategy;
    const declarativeDiscovery = surfaceDiscoveryStrategy?.kind === 'json-catalog'
      ? surfaceDiscoveryStrategy
      : null;
    if (declarativeDiscovery) {
      const url = resolveDeclarativeDiscoveryUrl(declarativeDiscovery, baseUrl);
      const payload = await getJson(url, {
        method: declarativeDiscovery.method ?? 'GET',
        headers: {
          ...this.createHeaders(provider, apiKey, connectionValues),
          ...declarativeDiscovery.headers,
        },
      });
      const parsedModels = parseDeclarativeCatalog(declarativeDiscovery, payload);
      const discoveredModels = requireModels(parsedModels.map((model) => ({
        id: model.id,
        label: model.label,
        enabled: true,
        aliases: model.aliases,
      })));
      const fallbackRoute = {
        protocol: provider.protocol,
        baseUrl,
      };
      const contributions = toDeclarativeCatalogContributions(parsedModels, fallbackRoute);
      const authoritative = definition.discovery.authority === 'authoritative-list';
      return {
        models: catalogOwnership !== 'user-managed' && !authoritative
          ? mergeManagedModelAvailability(managedModels, discoveredModels, {
            aliasesByModelId: buildManagedAliasIndex(provider.id),
          })
          : discoveredModels,
        contributions,
      };
    }
    if (
      provider.id === 'kimi-coding-plan'
      || provider.id === 'volcengine-coding-plan'
    ) {
      // Both Anthropic and OpenAI Coding Plan protocols share the same /models surface.
      // Always resolve through the Coding Plan helper so OpenAI never hits a wrong
      // `baseUrl + /models` shape when the draft base is still the Anthropic `/api/coding`.
      return this.validateCodingPlanModels(provider.id, apiKey, baseUrl, candidateModelIds, managedModels);
    }
    if (strategy === 'anthropic-candidate-validation') {
      return { models: await this.validateAnthropicCandidateModels(provider, apiKey, baseUrl, candidateModelIds, managedModels, connectionValues) };
    }
    if (strategy === 'azure-deployment') {
      return { models: await this.validateAzureCandidateModels(apiKey, baseUrl, candidateModelIds, managedModels) };
    }
    if (strategy === 'google-ai-studio') {
      const payload = await getJson(appendQueryParam(appendPath(baseUrl, '/models'), 'key', apiKey), {
        method: 'GET',
      });
      const discoveredModels = requireModels(parseModelsPayload(strategy, payload));
      return {
        models: catalogOwnership !== 'user-managed'
          ? mergeManagedModelAvailability(managedModels, discoveredModels, {
          aliasesByModelId: buildManagedAliasIndex(provider.id),
          })
          : discoveredModels,
      };
    }
    const url = strategy === 'ollama-tags'
      ? appendPath(new URL(baseUrl).origin, '/api/tags')
      : appendPath(baseUrl, '/models');
    const headers = this.createHeaders(provider, apiKey, connectionValues);
    const payload = await getJson(url, {
      method: 'GET',
      headers,
    });
    const discoveredModels = requireModels(parseModelsPayload(strategy, payload));
    return {
      models: catalogOwnership !== 'user-managed'
        ? mergeManagedModelAvailability(managedModels, discoveredModels, {
        aliasesByModelId: buildManagedAliasIndex(provider.id),
        })
        : discoveredModels,
    };
  }

  private async validateAnthropicCandidateModels(
    provider: LlmProviderEntry,
    apiKey: string,
    baseUrl: string,
    modelIds: string[],
    managedModels: LlmProviderModel[] = [],
    connectionValues: Readonly<Record<string, string>> = {},
  ): Promise<LlmProviderModel[]> {
    const validModels: string[] = [];
    const url = appendPath(baseUrl, '/messages');
    const headers = this.createHeaders(provider, apiKey, connectionValues);
    for (const modelId of modelIds) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
          body: createTinyAnthropicProbeBody(modelId),
        });
        clearTimeout(timeout);
        if (response.ok) {
          validModels.push(modelId);
        }
      } catch {
        // Continue probing the remaining candidates.
      }
    }
    const validatedModels = toStaticModels(validModels);
    return managedModels.length > 0
      ? mergeManagedModelAvailability(managedModels, validatedModels, {
        aliasesByModelId: buildManagedAliasIndex(provider.id),
      })
      : validatedModels;
  }

  private async validateCodingPlanModels(
    providerId: string,
    apiKey: string,
    baseUrl: string,
    modelIds: string[],
    managedModels: LlmProviderModel[] = [],
  ): Promise<ModelDiscoveryResult> {
    const modelsUrl = providerId === 'volcengine-coding-plan'
      ? resolveVolcengineCodingPlanModelsUrl(baseUrl)
      : resolveCodingPlanModelsUrl(baseUrl);
    const payload = await getJson(modelsUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': 'RDC-Agent',
      },
    });
    const discoveredModels = parseModelsPayload('openai-compatible', payload);
    const availableKeys = new Set(
      discoveredModels.flatMap((model) => [
        model.id.toLowerCase(),
        normalizeCodingPlanModelMatchKey(model.id),
      ]),
    );
    const aliasesByModelId = buildManagedAliasIndex(providerId);
    const matchedIds = modelIds.filter((modelId) => {
      const aliases = aliasesByModelId.get(modelId) ?? [];
      return [modelId, ...aliases].some((candidate) => (
        availableKeys.has(candidate.toLowerCase())
        || availableKeys.has(normalizeCodingPlanModelMatchKey(candidate))
      ));
    });
    // Prefer full discovered payload for merge so alias/meta reasons stay accurate.
    const validatedModels = matchedIds.length > 0
      ? toStaticModels(matchedIds)
      : discoveredModels;
    if (validatedModels.length === 0) {
      throw new ProviderConnectionError('Provider 暂未返回可用于 Agent 路由的模型');
    }
    const mergedModels = managedModels.length > 0
      ? mergeManagedModelAvailability(managedModels, discoveredModels.length > 0 ? discoveredModels : validatedModels, {
        aliasesByModelId,
        preserveMissing: providerId === 'kimi-coding-plan',
      })
      : validatedModels;
    const models = selectSupportedCodingPlanModels(providerId, mergedModels);
    const filteredModelCount = providerId === 'volcengine-coding-plan'
      ? Math.max(0, mergedModels.length - models.length)
      : 0;
    return {
      models,
      discoveryDiagnostic: {
        status: models.length === 0 ? 'no-supported-models' : 'matched',
        discoveredModelCount: discoveredModels.length,
        matchedModelCount: matchedIds.length,
        filteredModelCount,
      },
    };
  }

  private async validateAzureCandidateModels(
    apiKey: string,
    baseUrl: string,
    modelIds: string[],
    managedModels: LlmProviderModel[] = [],
  ): Promise<LlmProviderModel[]> {
    const validModels: string[] = [];
    const chatUrl = appendQueryParam(
      baseUrl.endsWith('/chat/completions') ? baseUrl : appendPath(baseUrl, '/chat/completions'),
      'api-version',
      '2024-10-21',
    );
    for (const modelId of modelIds) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        const response = await fetch(chatUrl, {
          method: 'POST',
          headers: {
            'api-key': apiKey,
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
          body: createTinyOpenAiProbeBody(modelId),
        });
        clearTimeout(timeout);
        if (response.ok) {
          validModels.push(modelId);
        }
      } catch {
        // Continue probing the remaining candidates.
      }
    }
    const validatedModels = toStaticModels(validModels);
    return managedModels.length > 0 ? mergeManagedModelAvailability(managedModels, validatedModels) : validatedModels;
  }

  private createHeaders(
    provider: LlmProviderEntry,
    apiKey: string,
    connectionValues: Readonly<Record<string, string>> = {},
  ): HeadersInit {
    const connectionHeaders = resolveProviderConnectionHeaders(provider.connectionSchema, connectionValues);
    if (provider.authMode === 'local') {
      return connectionHeaders;
    }
    if (provider.protocol === 'AnthropicMessages') {
      return {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        ...(provider.id === 'kimi-coding-plan' ? { 'User-Agent': 'RDC-Agent' } : {}),
        ...connectionHeaders,
      };
    }
    return {
      Authorization: `Bearer ${apiKey}`,
      ...connectionHeaders,
    };
  }
}

export const providerConnectionService = new ProviderConnectionService();
