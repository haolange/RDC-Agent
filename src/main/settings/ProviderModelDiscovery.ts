import {
  getProviderCatalogOwnership,
  getProviderDefaultBaseUrl,
  loadProviderSurface,
} from '../provider-catalog/ProviderCatalogRegistry';
import type { LlmProviderEntry, LlmProviderModel } from '@shared/types/settings';
import type { ProviderSurfaceDefinition } from '@shared/types/providerCapability';
import type { CatalogModelContribution } from './effectiveCatalogTypes';
import {
  parseDeclarativeCatalog,
  resolveDeclarativeDiscoveryUrl,
  toDeclarativeCatalogContributions,
} from './DeclarativeCatalogDiscovery';
import {
  parseClineCatalog,
  parseClinePassCatalog,
  parseFreeModelCatalog,
  parseKimiCodeCatalog,
  parseOpenCodeGoCatalog,
  parseOpenRouterAccountCatalog,
  type ParsedLiveCatalog,
} from './LiveProviderCatalogParsers';
import {
  resolveProviderConnectionHeaders,
} from './ProviderConnectionSchema';
import { resolveGoogleVertexAccessToken } from './GoogleApplicationCredentials';
import { createAwsBedrockRequestAuthorizer } from './AwsBedrockCredentials';
import { listSapAiCoreDeployments } from './SapAiCoreCredentials';
import { ProviderConnectionError } from './providerConnectionErrors';
import {
  appendPath,
  appendQueryParam,
  createTinyAnthropicProbeBody,
  createTinyOpenAiProbeBody,
  getJson,
  parseModelsPayload,
  REQUEST_TIMEOUT_MS,
} from './providerConnectionHttp';
import {
  buildManagedAliasIndex,
  mergeManagedModelAvailability,
  normalizeCodingPlanModelMatchKey,
  requireManagedModels,
  requireModels,
  selectSupportedCodingPlanModels,
  toStaticModels,
} from './providerConnectionModelUtils';
import {
  parseGoogleVertexPublisherModels,
  projectBedrockMantleModelRoutes,
  projectGoogleVertexModelRoutes,
  resolveClineCatalogUrl,
  resolveClineCredentialProbeUrl,
  resolveCodingPlanModelsUrl,
  resolveGoogleVertexOpenAiBaseUrl,
  resolveGoogleVertexPublisherModelsUrl,
  resolveVolcengineCodingPlanModelsUrl,
} from './providerConnectionUrls';

type ManifestProjectedCatalogParser = (
  payload: unknown,
  surface: ProviderSurfaceDefinition,
) => ParsedLiveCatalog;

const MANIFEST_PROJECTED_CATALOG_PARSERS: Readonly<Record<string, ManifestProjectedCatalogParser>> = {
  'kimi-code-catalog': parseKimiCodeCatalog,
  'opencode-go-catalog': parseOpenCodeGoCatalog,
  'openrouter-catalog': parseOpenRouterAccountCatalog,
  'cline-catalog': parseClineCatalog,
  'cline-pass-catalog': parseClinePassCatalog,
};

interface ModelDiscoveryResult {
  models: LlmProviderModel[];
  contributions?: CatalogModelContribution[];
  entitlementContributions?: CatalogModelContribution[];
  discoveryDiagnostic?: import('@shared/types/settings').LlmProviderConnectionResult['discoveryDiagnostic'];
}

function resolveDiscoveryStrategy(
  protocol: LlmProviderEntry['protocol'],
  discovery: ProviderSurfaceDefinition['discovery']['strategy'],
): string | null {
  if (!discovery) return null;
  const parserId = discovery.kind === 'custom-parser' ? discovery.parserId : undefined;
  if (parserId === 'kimi-code-catalog' || parserId === 'openrouter-catalog' || parserId === 'opencode-go-catalog' || parserId === 'cline-catalog' || parserId === 'cline-pass-catalog' || parserId === 'google-vertex-models'
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

function createDiscoveryHeaders(
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

async function validateAnthropicCandidateModels(
  provider: LlmProviderEntry,
  apiKey: string,
  baseUrl: string,
  modelIds: string[],
  managedModels: LlmProviderModel[] = [],
  connectionValues: Readonly<Record<string, string>> = {},
): Promise<LlmProviderModel[]> {
  const validModels: string[] = [];
  const url = appendPath(baseUrl, '/messages');
  const headers = createDiscoveryHeaders(provider, apiKey, connectionValues);
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

async function validateCodingPlanModels(
  providerId: string,
  apiKey: string,
  baseUrl: string,
  modelIds: string[],
  managedModels: LlmProviderModel[] = [],
): Promise<ModelDiscoveryResult> {
  const modelsUrl = resolveVolcengineCodingPlanModelsUrl(baseUrl);
  const payload = await getJson(modelsUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'User-Agent': 'RDC-Agent',
    },
  });
  const discoveredModels = parseModelsPayload({ kind: 'custom-parser', parserId: 'openai-compatible' }, payload);
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

async function validateAzureCandidateModels(
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

export async function discoverProviderModels(
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
    const models = requireModels(parseModelsPayload({ kind: 'custom-parser', parserId: 'openai-compatible' }, payload));
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
  const manifestProjectedParser = MANIFEST_PROJECTED_CATALOG_PARSERS[strategy];
  if (manifestProjectedParser) {
    const headers = strategy === 'kimi-code-catalog'
      ? {
          Authorization: 'Bearer ' + apiKey,
          'User-Agent': 'RDC-Agent',
          ...resolveProviderConnectionHeaders(provider.connectionSchema, connectionValues),
        }
      : createDiscoveryHeaders(provider, apiKey, connectionValues);
    // Cline catalog list endpoints are public; probe /users/me so fake keys fail closed.
    if (strategy === 'cline-catalog' || strategy === 'cline-pass-catalog') {
      await getJson(resolveClineCredentialProbeUrl(baseUrl), { method: 'GET', headers });
    }
    const url = strategy === 'kimi-code-catalog'
      ? resolveCodingPlanModelsUrl(baseUrl)
      : strategy === 'cline-catalog'
        ? resolveClineCatalogUrl(baseUrl, 'usage')
        : strategy === 'cline-pass-catalog'
          ? resolveClineCatalogUrl(baseUrl, 'pass')
          : appendPath(baseUrl, '/models');
    const parsed = manifestProjectedParser(
      await getJson(url, { method: 'GET', headers }),
      definition,
    );
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
        headers: createDiscoveryHeaders(provider, apiKey, connectionValues),
      }),
      getJson('https://cc.freemodel.dev/v1/models', {
        method: 'GET',
        headers: createDiscoveryHeaders(provider, apiKey, connectionValues),
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
        headers: createDiscoveryHeaders(provider, apiKey, connectionValues),
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
      headers: createDiscoveryHeaders(provider, apiKey, connectionValues),
    });
    const discovered = parseModelsPayload({ kind: 'custom-parser', parserId: 'openai-compatible' }, payload);
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
        ...createDiscoveryHeaders(provider, apiKey, connectionValues),
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
    provider.id === 'volcengine-coding-plan'
  ) {
    // Both Anthropic and OpenAI Coding Plan protocols share the same /models surface.
    // Always resolve through the Coding Plan helper so OpenAI never hits a wrong
    // `baseUrl + /models` shape when the draft base is still the Anthropic `/api/coding`.
    return validateCodingPlanModels(provider.id, apiKey, baseUrl, candidateModelIds, managedModels);
  }
  if (strategy === 'anthropic-candidate-validation') {
    return { models: await validateAnthropicCandidateModels(provider, apiKey, baseUrl, candidateModelIds, managedModels, connectionValues) };
  }
  if (strategy === 'azure-deployment') {
    return { models: await validateAzureCandidateModels(apiKey, baseUrl, candidateModelIds, managedModels) };
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
  const headers = createDiscoveryHeaders(provider, apiKey, connectionValues);
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
