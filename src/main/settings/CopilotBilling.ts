import type {
  ContextTier,
  EntitlementState,
  ModelRouteOption,
} from '@shared/types/providerCapability';
import type { LlmProviderModel } from '@shared/types/settings';
import type { CatalogModelContribution } from './effectiveCatalogTypes';
import { extractDiscoveredModelIdentity, isAdmittedDiscoveredModel } from './DiscoveryAdmission';

export interface CopilotModelCapabilityMetadata {
  limits: {
    maxPromptTokens?: number;
    maxOutputTokens?: number;
    maxTotalTokens?: number;
  };
  tokenPrices: Record<string, unknown>;
  entitlement?: EntitlementState;
}

export interface CopilotCatalogParseResult {
  models: LlmProviderModel[];
  contributions: CatalogModelContribution[];
  billingByModel: Record<string, CopilotModelCapabilityMetadata>;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : undefined;
}

function entitlement(value: unknown): EntitlementState {
  const tier = record(value);
  if (tier.entitlement === 'granted' || tier.entitlement === 'denied' || tier.entitlement === 'unknown') {
    return tier.entitlement;
  }
  for (const key of ['entitled', 'enabled', 'available']) {
    if (tier[key] === true) return 'granted';
    if (tier[key] === false) return 'denied';
  }
  return 'unknown';
}

function copilotRouteOptions(endpoints: readonly string[], apiBaseUrl: string): ModelRouteOption[] {
  const protocols = new Set<ModelRouteOption['route']['protocol']>();
  for (const endpoint of endpoints) {
    if (endpoint.includes('/v1/messages')) protocols.add('AnthropicMessages');
    else if (endpoint.includes('/responses')) protocols.add('OpenAIResponses');
    else if (endpoint.includes('/chat/completions')) protocols.add('OpenAICompatibleChatCompletions');
  }
  const normalizedBaseUrl = apiBaseUrl.trim().replace(/\/+$/, '');
  return [...protocols].map((protocol) => ({
    id: protocol,
    route: {
      protocol,
      baseUrl: protocol === 'AnthropicMessages' && !normalizedBaseUrl.endsWith('/v1')
        ? `${normalizedBaseUrl}/v1`
        : normalizedBaseUrl,
      source: 'model',
    },
    availability: 'available',
    protocolOwner: protocol === 'AnthropicMessages' ? 'anthropic' : 'openai',
    endpointOwner: 'github',
    authMode: 'account',
  }));
}

function copilotPolicyDenied(entry: Record<string, unknown>): boolean {
  const policy = record(entry.policy);
  const state = typeof policy.state === 'string' ? policy.state.toLowerCase() : '';
  return entry.model_picker_enabled === false
    || entry.entitled === false
    || policy.allowed === false
    || policy.enabled === false
    || state === 'denied'
    || state === 'disabled';
}

export function parseCopilotBillingTiers(billing: unknown): ContextTier[] {
  const metadata = record(billing);
  const limits = record(metadata.limits);
  const tokenPrices = record(metadata.tokenPrices);
  const maxOutputTokens = positiveInteger(limits.maxOutputTokens);
  const liveMaxTotalTokens = positiveInteger(limits.maxTotalTokens);
  const liveMaxPromptTokens = positiveInteger(limits.maxPromptTokens);
  const modelEntitlement = metadata.entitlement === 'granted'
    || metadata.entitlement === 'denied'
    || metadata.entitlement === 'unknown'
    ? metadata.entitlement
    : undefined;
  const tiers: ContextTier[] = [];
  for (const [id, label] of [['default', 'Default'], ['long_context', 'Long context']] as const) {
    const price = record(tokenPrices[id]);
    const contextMax = positiveInteger(price.context_max)
      ?? (id === 'default' ? liveMaxPromptTokens : undefined);
    if (!contextMax && !(id === 'default' && liveMaxTotalTokens)) continue;
    const maxTotalTokens = id === 'long_context'
      ? contextMax
        ? Math.max(liveMaxTotalTokens ?? 0, contextMax + (maxOutputTokens ?? 0)) || undefined
        : undefined
      : liveMaxTotalTokens ?? (contextMax && maxOutputTokens ? contextMax + maxOutputTokens : undefined);
    tiers.push({
      id,
      label,
      ...(contextMax ? { maxPromptTokens: contextMax } : {}),
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
      ...(maxTotalTokens ? { maxTotalTokens } : {}),
      activation: { kind: 'implicit' },
      entitlement: modelEntitlement === 'denied'
        ? 'denied'
        : Object.keys(price).length > 0 ? entitlement(price) : modelEntitlement ?? 'granted',
    });
  }
  return tiers;
}

export function parseCopilotModelCatalog(
  payload: unknown,
  apiBaseUrl = 'https://api.githubcopilot.com',
): CopilotCatalogParseResult {
  const collection = Array.isArray(record(payload).data) ? record(payload).data as unknown[] : [];
  const billingByModel: Record<string, CopilotModelCapabilityMetadata> = {};
  const models: LlmProviderModel[] = [];
  const contributions: CatalogModelContribution[] = [];
  const seen = new Set<string>();
  for (const item of collection) {
    const entry = record(item);
    const discoveredId = typeof entry.id === 'string' ? entry.id.trim() : '';
    const identity = extractDiscoveredModelIdentity(entry);
    const id = identity.id;
    const capabilities = record(entry.capabilities);
    const capabilityType = typeof capabilities.type === 'string' ? capabilities.type.toLowerCase() : '';
    const supportedEndpoints = Array.isArray(entry.supported_endpoints)
      ? entry.supported_endpoints.filter((value): value is string => typeof value === 'string')
      : [];
    const supportsChatEndpoint = supportedEndpoints.length === 0 || supportedEndpoints.some((endpoint) => (
      endpoint.includes('/chat/completions') || endpoint.includes('/responses') || endpoint.includes('/v1/messages')
    ));
    if (
      !discoveredId
      || !id
      || seen.has(id)
      || (capabilityType && capabilityType !== 'chat')
      || !supportsChatEndpoint
      || !isAdmittedDiscoveredModel(entry)
    ) continue;
    seen.add(id);
    const label = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : id;
    const routeOptions = copilotRouteOptions(supportedEndpoints, apiBaseUrl);
    const deniedByAccountPolicy = copilotPolicyDenied(entry);
    const unavailableReason = deniedByAccountPolicy
      ? 'This model is disabled by the current Copilot account, plan, client, or organization policy.'
      : undefined;
    models.push({
      id,
      label,
      enabled: true,
      ...(identity.aliases.length > 0 ? { aliases: identity.aliases } : {}),
      availability: deniedByAccountPolicy ? 'unavailable' : 'available',
      ...(unavailableReason ? { availabilityReason: unavailableReason } : {}),
    });
    const limits = record(capabilities.limits);
    const maxPromptTokens = positiveInteger(limits.max_prompt_tokens);
    const maxOutputTokens = positiveInteger(limits.max_output_tokens);
    const liveMaxTotalTokens = positiveInteger(limits.max_context_window_tokens)
      ?? positiveInteger(limits.max_context_window)
      ?? positiveInteger(limits.max_total_tokens);
    const maxTotalTokens = liveMaxTotalTokens;
    const contextEntitlement: EntitlementState = deniedByAccountPolicy ? 'denied' : 'granted';
    contributions.push({
      modelId: id,
      ...(identity.aliases.length > 0 ? { aliases: identity.aliases } : {}),
      label,
      availability: deniedByAccountPolicy ? 'unavailable' : 'available',
      ...(unavailableReason ? { unavailableReason } : {}),
      ...(routeOptions.length > 0 ? { routeOptions } : {}),
      ...(routeOptions.length === 1 ? { preferredRouteOptionId: routeOptions[0].id } : {}),
    });
    const metadata: CopilotModelCapabilityMetadata = {
      limits: {
        ...(maxPromptTokens ? { maxPromptTokens } : {}),
        ...(maxOutputTokens ? { maxOutputTokens } : {}),
        ...(maxTotalTokens ? { maxTotalTokens } : {}),
      },
      tokenPrices: record(record(entry.billing).token_prices),
      entitlement: contextEntitlement,
    };
    if (parseCopilotBillingTiers(metadata).length > 0) billingByModel[id] = metadata;
  }
  return {
    models,
    contributions,
    billingByModel,
  };
}
