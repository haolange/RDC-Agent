import type { ContextTier, EntitlementState } from '@shared/types/providerCapability';
import type { LlmProviderModel } from '@shared/types/settings';

export interface CopilotCatalogParseResult {
  models: LlmProviderModel[];
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
  const seen = new Set<string>();
  for (const item of collection) {
    const entry = record(item);
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({
      id,
      label: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : id,
      enabled: true,
      availability: 'available',
    });
    if (entry.billing && parseCopilotBillingTiers(entry.billing).length > 0) {
      billingByModel[id] = entry.billing;
    }
  }
  return { models, billingByModel };
}
