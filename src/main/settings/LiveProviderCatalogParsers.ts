import type { CatalogModelContribution } from './EffectiveCatalogService';
import type { CapabilityState } from '@shared/types/providerCapability';
import type {
  NamedReasoningLevel,
  OpenAiWireEffort,
  ReasoningControl,
} from '@shared/types/modelCapability';
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

function capabilityState(value: unknown): CapabilityState {
  if (value === true) return { state: 'supported' };
  if (value === false) return { state: 'unsupported' };
  return { state: 'unknown' };
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

export function mergeParsedLiveCatalogs(...catalogs: ParsedLiveCatalog[]): ParsedLiveCatalog {
  const byId = new Map<string, CatalogModelContribution>();
  for (const catalog of catalogs) {
    for (const contribution of catalog.contributions) {
      byId.set(contribution.modelId, contribution);
    }
  }
  return asResult([...byId.values()]);
}

const REASONING_LEVEL_MAP: Record<string, NamedReasoningLevel | undefined> = {
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'extra',
  extra: 'extra',
  max: 'max',
  ultra: 'ultra',
};

const OPENAI_EFFORT_MAP: Record<NamedReasoningLevel, OpenAiWireEffort> = {
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  extra: 'xhigh',
  max: 'max',
  ultra: 'ultra',
};

function reasoningLevels(values: unknown): NamedReasoningLevel[] {
  if (!Array.isArray(values)) return [];
  const normalized = values.flatMap((value): NamedReasoningLevel[] => {
    const effort = typeof value === 'string' ? value : text(record(value).effort) ?? text(record(value).id) ?? text(record(value).value);
    const level = effort ? REASONING_LEVEL_MAP[effort.toLowerCase()] : undefined;
    return level ? [level] : [];
  });
  return [...new Set(normalized)];
}

function openAiReasoning(
  values: unknown,
  defaultValue: unknown,
  protocol: 'openai-responses' | 'openai-compatible' = 'openai-responses',
): ReasoningControl {
  const levels = reasoningLevels(values);
  if (levels.length === 0) {
    return {
      kind: 'none', supportsOff: true, levels: [], defaultSelection: 'off',
      lockedSelection: 'off', wireProfile: { kind: 'none' },
    };
  }
  const requestedDefault = text(defaultValue)?.toLowerCase();
  const mappedDefault = requestedDefault ? REASONING_LEVEL_MAP[requestedDefault] : undefined;
  const defaultSelection = mappedDefault && levels.includes(mappedDefault) ? mappedDefault : levels[0];
  const wireLevels = Object.fromEntries(levels.map((level) => [level, OPENAI_EFFORT_MAP[level]]));
  return {
    kind: 'levels',
    supportsOff: false,
    levels,
    defaultSelection,
    wireProfile: protocol === 'openai-responses'
      ? { kind: 'openai-responses', on: defaultSelection, levels: wireLevels }
      : { kind: 'openai-compatible', on: defaultSelection, levels: wireLevels },
  };
}

/** Parse the account-specific Codex manifest; web-only Instant/Thinking/Pro variants are excluded. */
export function parseChatGptAccountCatalog(payload: unknown): ParsedLiveCatalog {
  const root = record(payload);
  const values = Array.isArray(root.models) ? root.models : [];
  return asResult(values.flatMap((candidate): CatalogModelContribution[] => {
    const value = record(candidate);
    const id = text(value.slug) ?? text(value.id);
    if (
      !id
      || value.supported_in_api === false
      || (text(value.visibility) && text(value.visibility) !== 'list')
      || /(?:^|-)pro$/i.test(id)
      || /(?:auto-review|compaction)/i.test(id)
    ) return [];
    const contextWindow = positiveInteger(value.context_window);
    const maxContextWindow = positiveInteger(value.max_context_window);
    const contextTiers: NonNullable<CatalogModelContribution['contextTiers']> = [{
      id: 'default',
      label: 'Codex service limit',
      ...(contextWindow ? { maxPromptTokens: contextWindow } : {}),
      activation: { kind: 'implicit' },
      entitlement: 'granted',
    }];
    if (contextWindow && maxContextWindow && maxContextWindow > contextWindow) {
      contextTiers.push({
        id: 'max',
        label: 'Maximum Codex limit',
        maxPromptTokens: maxContextWindow,
        activation: { kind: 'implicit' },
        entitlement: 'unknown',
      });
    }
    const inputModalities = Array.isArray(value.input_modalities)
      ? value.input_modalities.map((entry) => text(entry)?.toLowerCase()).filter(Boolean)
      : [];
    return [{
      modelId: id,
      label: text(value.display_name) ?? text(value.name) ?? id,
      availability: 'available',
      route: { protocol: 'OpenAIResponses', baseUrl: 'https://chatgpt.com/backend-api/codex', source: 'model' },
      contextTiers,
      ...(contextWindow ? { defaultBudgetTokens: contextWindow } : {}),
      fast: { kind: 'request-param', patch: { service_tier: 'priority' }, entitlement: 'granted', label: 'Fast' },
      reasoning: openAiReasoning(value.supported_reasoning_levels, value.default_reasoning_level),
      toolCalling: { state: 'supported' },
      visionInput: inputModalities.length === 0
        ? { state: 'unknown' }
        : capabilityState(inputModalities.includes('image')),
      structuredOutput: { state: 'supported' },
    }];
  }));
}

/** The Anthropic model endpoint is authoritative for account-visible ids, not for undocumented limits. */
export function parseClaudeAccountCatalog(payload: unknown): ParsedLiveCatalog {
  return asResult(records(payload).flatMap((value): CatalogModelContribution[] => {
    const id = modelId(value);
    if (!id) return [];
    return [{
      modelId: id,
      label: text(value.display_name) ?? text(value.label) ?? id,
      availability: 'available',
      route: { protocol: 'AnthropicMessages', baseUrl: 'https://api.anthropic.com/v1', source: 'model' },
    }];
  }));
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
        activation: { kind: 'implicit' }, entitlement: 'granted',
      }],
      ...(contextTokens(value) ? { defaultBudgetTokens: contextTokens(value) } : {}),
      fast: { kind: 'unsupported' },
      toolCalling: capabilityState(record(value.capabilities).tool_calls),
      visionInput: capabilityState(record(value.capabilities).vision),
      structuredOutput: capabilityState(record(value.capabilities).structured_output),
    }];
  }));
}

/** Parse the Grok Build subscription catalog returned by cli-chat-proxy. */
export function parseGrokBuilderCatalog(payload: unknown): ParsedLiveCatalog {
  const modelMap = record(record(payload).models);
  return asResult(Object.values(modelMap).flatMap((candidate): CatalogModelContribution[] => {
    const wrapper = record(candidate);
    const info = record(wrapper.info);
    const value = Object.keys(info).length > 0 ? info : wrapper;
    const id = modelId(value);
    if (!id || value.hidden === true || value.supported_in_api === false) return [];
    const contextWindow = contextTokens(value);
    const supportsReasoning = value.supports_reasoning_effort === true;
    return [{
      modelId: id,
      label: text(value.name) ?? text(value.label) ?? id,
      availability: 'available',
      route: {
        protocol: text(value.api_backend)?.toLowerCase() === 'responses'
          ? 'OpenAIResponses'
          : 'OpenAICompatibleChatCompletions',
        baseUrl: 'https://cli-chat-proxy.grok.com/v1',
        source: 'model',
      },
      contextTiers: [{
        id: 'default', label: 'Grok Build limit', ...(contextWindow ? { maxPromptTokens: contextWindow } : {}),
        activation: { kind: 'implicit' }, entitlement: 'granted',
      }],
      ...(contextWindow ? { defaultBudgetTokens: contextWindow } : {}),
      fast: { kind: 'unsupported' },
      reasoning: supportsReasoning
        ? openAiReasoning(value.reasoning_efforts, value.reasoning_effort)
        : openAiReasoning([], undefined),
      toolCalling: { state: 'supported' },
      visionInput: { state: 'unknown' },
      structuredOutput: { state: 'unknown' },
    }];
  }));
}
