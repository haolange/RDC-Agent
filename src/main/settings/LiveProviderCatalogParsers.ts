import type { CatalogModelContribution } from './EffectiveCatalogService';
import type { LlmProviderModel } from '@shared/types/settings';

export interface ParsedLiveCatalog {
  models: LlmProviderModel[];
  contributions: CatalogModelContribution[];
}

function records(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as Record<string, unknown>;
  const candidates = [root.data, root.models, root.items];
  const values = candidates.find(Array.isArray);
  return Array.isArray(values)
    ? values.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object')
    : [];
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function modelId(value: Record<string, unknown>): string | undefined {
  return text(value.id) ?? text(value.model) ?? text(value.name);
}

function contextTokens(value: Record<string, unknown>): number | undefined {
  const raw = value.context_window ?? value.contextWindow ?? value.context_length;
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function asResult(contributions: CatalogModelContribution[]): ParsedLiveCatalog {
  const sorted = [...contributions].sort((left, right) => left.modelId.localeCompare(right.modelId));
  return {
    contributions: sorted,
    models: sorted.map((model) => ({ id: model.modelId, label: model.label ?? model.modelId, enabled: true })),
  };
}

function opencodeProtocol(value: Record<string, unknown>): 'AnthropicMessages' | 'OpenAIResponses' | 'OpenAICompatibleChatCompletions' {
  const endpoint = text(value.endpoint)?.toLowerCase() ?? '';
  const api = (text(value.api) ?? text(value.protocol) ?? '').toLowerCase();
  const sdk = text(value.npm)?.toLowerCase() ?? '';
  if (endpoint.includes('/messages') || api.includes('anthropic') || sdk.includes('anthropic')) return 'AnthropicMessages';
  if (endpoint.includes('/responses') || api.includes('responses')) return 'OpenAIResponses';
  return 'OpenAICompatibleChatCompletions';
}

/** Parse OpenCode Go's account catalog without collapsing its per-model API surface. */
export function parseOpenCodeGoCatalog(payload: unknown): ParsedLiveCatalog {
  const contributions = records(payload).flatMap((value): CatalogModelContribution[] => {
    const id = modelId(value);
    if (!id) return [];
    const protocol = opencodeProtocol(value);
    return [{
      modelId: id,
      label: text(value.label) ?? text(value.name) ?? id,
      availability: 'available',
      route: { protocol, baseUrl: 'https://opencode.ai/zen/go/v1', source: 'model' },
      contextTiers: [{
        id: 'default',
        label: 'Default',
        maxPromptTokens: contextTokens(value),
        activation: { kind: 'implicit' },
        entitlement: 'granted',
      }],
    }];
  });
  return asResult(contributions);
}

function hasClinePass(value: Record<string, unknown>): boolean {
  const entitlement = text(value.entitlement)?.toLowerCase();
  const groups = Array.isArray(value.groups) ? value.groups.map((entry) => text(entry)?.toLowerCase()) : [];
  return entitlement === 'clinepass' || entitlement === 'cline-pass' || groups.includes('clinepass') || groups.includes('cline-pass');
}

/** ClinePass is entitlement evidence only when the catalog says so explicitly. */
export function parseClineCatalog(payload: unknown): ParsedLiveCatalog {
  const contributions = records(payload).flatMap((value): CatalogModelContribution[] => {
    const id = modelId(value);
    if (!id) return [];
    return [{
      modelId: id,
      label: text(value.label) ?? text(value.name) ?? id,
      availability: 'available',
      route: { protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://api.cline.bot/api/v1', source: 'preset' },
      contextTiers: [{
        id: 'default',
        label: hasClinePass(value) ? 'ClinePass' : 'Default',
        maxPromptTokens: contextTokens(value),
        activation: { kind: 'implicit' },
        entitlement: hasClinePass(value) ? 'granted' : 'unknown',
      }],
    }];
  });
  return asResult(contributions);
}

/** Grok account models are accepted only from the live account catalog. */
export function parseGrokAccountCatalog(payload: unknown): ParsedLiveCatalog {
  return asResult(records(payload).flatMap((value): CatalogModelContribution[] => {
    const id = modelId(value);
    if (!id) return [];
    return [{
      modelId: id,
      label: text(value.label) ?? id,
      availability: 'available',
      route: { protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://api.x.ai/v1', source: 'model' },
      contextTiers: [{
        id: 'default', label: 'Default', maxPromptTokens: contextTokens(value),
        activation: { kind: 'implicit' }, entitlement: 'unknown',
      }],
    }];
  }));
}
