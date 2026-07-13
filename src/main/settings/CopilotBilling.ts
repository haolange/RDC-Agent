import type { ContextTier, EntitlementState } from '@shared/types/providerCapability';
import type { LlmProviderModel } from '@shared/types/settings';
import type { CatalogModelContribution } from './EffectiveCatalogService';
import { extractDiscoveredModelIdentity, isAdmittedDiscoveredModel } from './DiscoveryAdmission';
import { normalizeCopilotDiscoveryModels } from './ProviderDiscoveryNormalizer';

export interface CopilotCatalogParseResult {
  models: LlmProviderModel[];
  contributions: CatalogModelContribution[];
  billingByModel: Record<string, unknown>;
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

export function parseCopilotBillingTiers(billing: unknown): ContextTier[] {
  const tokenPrices = record(record(billing).token_prices);
  const tiers: ContextTier[] = [];
  for (const [id, label] of [['default', 'Default'], ['long_context', 'Long context']] as const) {
    const price = record(tokenPrices[id]);
    const contextMax = positiveInteger(price.context_max);
    if (!contextMax) continue;
    tiers.push({
      id,
      label,
      maxPromptTokens: contextMax,
      activation: { kind: 'implicit' },
      entitlement: entitlement(price),
    });
  }
  return tiers;
}

export function parseCopilotModelCatalog(payload: unknown): CopilotCatalogParseResult {
  const collection = Array.isArray(record(payload).data) ? record(payload).data as unknown[] : [];
  const billingByModel: Record<string, unknown> = {};
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
    if (
      !discoveredId
      || !id
      || seen.has(id)
      || entry.model_picker_enabled === false
      || (capabilityType && capabilityType !== 'chat')
      || (supportedEndpoints.length > 0 && !supportedEndpoints.some((endpoint) => (
        endpoint.includes('/chat/completions') || endpoint.includes('/responses') || endpoint.includes('/v1/messages')
      )))
      || !isAdmittedDiscoveredModel(entry)
    ) continue;
    seen.add(id);
    const label = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : id;
    models.push({
      id,
      label,
      enabled: true,
      ...(identity.aliases.length > 0 ? { aliases: identity.aliases } : {}),
      availability: 'available',
    });
    const limits = record(capabilities.limits);
    const supports = record(capabilities.supports);
    const maxPromptTokens = positiveInteger(limits.max_prompt_tokens);
    contributions.push({
      modelId: id,
      ...(identity.aliases.length > 0 ? { aliases: identity.aliases } : {}),
      label,
      availability: 'available',
      ...(maxPromptTokens
        ? {
            contextTiers: [{
              id: 'default', label: 'Default', maxPromptTokens,
              activation: { kind: 'implicit' }, entitlement: 'granted',
            }],
            defaultBudgetTokens: maxPromptTokens,
          }
        : {}),
      toolCalling: supports.tool_calls === true
        ? { state: 'supported' }
        : supports.tool_calls === false ? { state: 'unsupported' } : { state: 'unknown' },
      visionInput: supports.vision === true
        ? { state: 'supported' }
        : supports.vision === false ? { state: 'unsupported' } : { state: 'unknown' },
      structuredOutput: supports.structured_outputs === true || supports.response_format === true
        ? { state: 'supported' }
        : supports.structured_outputs === false || supports.response_format === false
          ? { state: 'unsupported' }
          : { state: 'unknown' },
    });
    if (entry.billing && parseCopilotBillingTiers(entry.billing).length > 0) {
      billingByModel[id] = entry.billing;
    }
  }
  const normalizedContributions = normalizeCopilotDiscoveryModels(contributions);
  const visibleIds = new Set(normalizedContributions.map((model) => model.modelId));
  return {
    models: models.filter((model) => visibleIds.has(model.id)),
    contributions: normalizedContributions,
    billingByModel,
  };
}
