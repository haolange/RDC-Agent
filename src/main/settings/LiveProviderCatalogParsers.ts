import type { CatalogModelContribution } from './EffectiveCatalogService';
import type { CapabilityState, ProviderSurfaceDefinition } from '@shared/types/providerCapability';
import type {
  NamedReasoningLevel,
  OpenAiWireEffort,
  ReasoningControl,
} from '@shared/types/modelCapability';
import type { LlmProviderModel, LlmProviderProtocol } from '@shared/types/settings';
import { extractDiscoveredModelIdentity, isAdmittedDiscoveredModel } from './DiscoveryAdmission';
import { projectLiveModelObservations, type LiveModelObservation } from './LiveProviderCatalogProjection';

export interface GrokBuilderCatalogDiagnostic {
  envelopeKind: 'root-array' | 'models-array' | 'models-map' | 'data-array' | 'items-array' | 'unknown';
  candidateCount: number;
  admittedCount: number;
  filtered: {
    invalidIdentity: number;
    hidden: number;
    unsupportedInApi: number;
  };
}

export interface ParsedLiveCatalog {
  models: LlmProviderModel[];
  contributions: CatalogModelContribution[];
  entitlementContributions?: CatalogModelContribution[];
  diagnostic?: GrokBuilderCatalogDiagnostic;
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

function explicitCapabilityState(value: unknown): CapabilityState | undefined {
  if (value === true) return { state: 'supported' };
  if (value === false) return { state: 'unsupported' };
  return undefined;
}

function modelId(value: Record<string, unknown>): string | undefined {
  return text(value.id) ?? text(value.model) ?? text(value.name);
}

function liveIdentity(
  value: Record<string, unknown>,
  explicitId = modelId(value),
): { id: string; aliases: string[] } | null {
  if (!explicitId) return null;
  const candidate = { ...value, id: explicitId };
  if (!isAdmittedDiscoveredModel(candidate)) return null;
  const identity = extractDiscoveredModelIdentity(candidate);
  return identity.id ? identity : null;
}

function contextTokens(value: Record<string, unknown>): number | undefined {
  const raw = value.context_window ?? value.contextWindow ?? value.context_length;
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function mergeContributions(contributions: CatalogModelContribution[]): CatalogModelContribution[] {
  const byId = new Map<string, CatalogModelContribution>();
  for (const contribution of contributions) {
    const previous = byId.get(contribution.modelId);
    byId.set(contribution.modelId, previous
      ? {
          ...previous,
          ...contribution,
          aliases: [...new Set([...(previous.aliases ?? []), ...(contribution.aliases ?? [])])],
        }
      : contribution);
  }
  return [...byId.values()].sort((left, right) => left.modelId.localeCompare(right.modelId));
}

function asResult(
  contributions: CatalogModelContribution[],
  entitlementContributions: CatalogModelContribution[] = [],
): ParsedLiveCatalog {
  const sorted = mergeContributions(contributions);
  const entitlements = mergeContributions(entitlementContributions);
  return {
    contributions: sorted,
    ...(entitlements.length > 0 ? { entitlementContributions: entitlements } : {}),
    models: sorted.map((model) => ({
      id: model.modelId,
      label: model.label ?? model.modelId,
      enabled: true,
      ...(model.aliases?.length ? { aliases: [...model.aliases] } : {}),
    })),
  };
}

export function mergeParsedLiveCatalogs(...catalogs: ParsedLiveCatalog[]): ParsedLiveCatalog {
  return asResult(
    catalogs.flatMap((catalog) => catalog.contributions),
    catalogs.flatMap((catalog) => catalog.entitlementContributions ?? []),
  );
}

const REASONING_LEVEL_MAP: Record<string, NamedReasoningLevel | undefined> = {
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
};

const OPENAI_EFFORT_MAP: Record<NamedReasoningLevel, OpenAiWireEffort> = {
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
};

const CHATGPT_SPARK_MODEL_ID = 'gpt-5.3-codex-spark';

function reasoningLevels(values: unknown): NamedReasoningLevel[] {
  if (!Array.isArray(values)) return [];
  const normalized = values.flatMap((value): NamedReasoningLevel[] => {
    const effort = typeof value === 'string' ? value : text(record(value).effort) ?? text(record(value).id) ?? text(record(value).value);
    const level = effort ? REASONING_LEVEL_MAP[effort.toLowerCase()] : undefined;
    return level ? [level] : [];
  });
  return [...new Set(normalized)];
}

export function parseOpenAiReasoningControl(
  values: unknown,
  defaultValue: unknown,
  protocol: 'openai-responses' | 'openai-compatible' = 'openai-responses',
): ReasoningControl {
  const levels = reasoningLevels(values);
  const declaredValues = Array.isArray(values)
    ? values.map((value) => (
        typeof value === 'string'
          ? value
          : text(record(value).effort) ?? text(record(value).id) ?? text(record(value).value) ?? ''
      ).toLowerCase())
    : [];
  const supportsOff = declaredValues.includes('off') || declaredValues.includes('none');
  if (levels.length === 0) {
    const kind = Array.isArray(values) ? 'none' : 'unknown';
    return {
      kind,
      supportsOff: kind === 'none',
      levels: [],
      defaultSelection: 'off',
      ...(kind === 'none' ? { lockedSelection: 'off' as const } : {}),
      wireProfile: { kind: 'none' },
    };
  }
  const requestedDefault = text(defaultValue)?.toLowerCase();
  const mappedDefault = requestedDefault ? REASONING_LEVEL_MAP[requestedDefault] : undefined;
  const defaultSelection = supportsOff && (requestedDefault === 'off' || requestedDefault === 'none')
    ? 'off' as const
    : mappedDefault && levels.includes(mappedDefault) ? mappedDefault : levels[0];
  const onSelection = defaultSelection === 'off' ? levels[0] : defaultSelection;
  const wireLevels = Object.fromEntries(levels.map((level) => [level, OPENAI_EFFORT_MAP[level]]));
  return {
    kind: 'levels',
    supportsOff,
    levels,
    defaultSelection,
    wireProfile: protocol === 'openai-responses'
      ? { kind: 'openai-responses', on: onSelection, levels: wireLevels }
      : {
          kind: 'openai-compatible',
          on: onSelection,
          levels: wireLevels,
          ...(supportsOff ? { offMode: 'reasoning-none' as const } : {}),
        },
  };
}


function strictCatalogRecords(payload: unknown, surfaceLabel: string): Record<string, unknown>[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`${surfaceLabel} catalog must be an object envelope.`);
  }
  const root = payload as Record<string, unknown>;
  const values = Array.isArray(root.data) ? root.data : Array.isArray(root.models) ? root.models : null;
  if (!values) throw new Error(`${surfaceLabel} catalog is missing a data or models array.`);
  return values.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${surfaceLabel} catalog contains a non-object entry.`);
    }
    const entry = value as Record<string, unknown>;
    if (!text(entry.id)) throw new Error(`${surfaceLabel} catalog contains an entry without an id.`);
    return entry;
  });
}

function explicitProtocol(value: Record<string, unknown>): LlmProviderProtocol | undefined {
  const protocol = text(value.protocol)?.toLowerCase();
  const endpoint = text(value.endpoint)?.toLowerCase();
  const api = text(value.api)?.toLowerCase();
  const sdk = text(value.npm)?.toLowerCase();
  const backend = text(value.api_backend)?.toLowerCase();
  const joined = [protocol, endpoint, api, sdk, backend].filter(Boolean).join(' ');
  if (joined.includes('anthropic') || joined.includes('/messages')) return 'AnthropicMessages';
  if (joined.includes('responses') || joined.includes('/responses')) return 'OpenAIResponses';
  if (joined.includes('openai') || joined.includes('chat/completions')) return 'OpenAICompatibleChatCompletions';
  return undefined;
}

function observedReasoning(value: Record<string, unknown>): LiveModelObservation['reasoning'] | undefined {
  const supported = value.supports_reasoning === true || value.supports_reasoning_effort === true
    ? true
    : value.supports_reasoning === false || value.supports_reasoning_effort === false ? false : undefined;
  const efforts = record(value.think_efforts);
  const levels = reasoningLevels(efforts.valid_efforts ?? value.think_efforts ?? value.reasoning_efforts);
  const rawDefault = text(efforts.default_effort ?? value.default_effort ?? value.reasoning_effort)?.toLowerCase();
  const defaultEffort = rawDefault ? REASONING_LEVEL_MAP[rawDefault] : undefined;
  const rawThinkingType = text(value.supports_thinking_type)?.toLowerCase();
  const thinkingType = rawThinkingType === 'only' || rawThinkingType === 'optional' || rawThinkingType === 'both'
    ? rawThinkingType
    : undefined;
  if (supported === undefined && levels.length === 0 && !thinkingType) return undefined;
  return {
    ...(supported !== undefined ? { supported } : {}),
    ...(levels.length ? { efforts: levels } : {}),
    ...(defaultEffort ? { defaultEffort } : {}),
    ...(thinkingType ? { thinkingType } : {}),
  };
}

function observationFromCatalogRow(value: Record<string, unknown>): LiveModelObservation | null {
  const identity = liveIdentity(value);
  if (!identity) return null;
  const toolCalling = explicitCapabilityState(value.supports_tool_call ?? value.supports_tools ?? value.tool_call);
  const visionInput = explicitCapabilityState(value.supports_image ?? value.supports_vision ?? value.image);
  const structuredOutput = explicitCapabilityState(value.supports_structured_output ?? value.structured_output);
  return {
    modelId: identity.id,
    ...(identity.aliases.length ? { aliases: identity.aliases } : {}),
    upstreamLabel: text(value.display_name) ?? text(value.label) ?? text(value.name),
    availability: 'available',
    protocol: explicitProtocol(value),
    contextWindowTokens: contextTokens(value),
    reasoning: observedReasoning(value),
    ...(toolCalling ? { toolCalling } : {}),
    ...(visionInput ? { visionInput } : {}),
    ...(structuredOutput ? { structuredOutput } : {}),
  };
}

/** Parse only credential-scoped observations; compiled manifests own product identity and controls. */
export function parseKimiCodeCatalog(
  payload: unknown,
  surface: ProviderSurfaceDefinition,
): ParsedLiveCatalog {
  const observations = strictCatalogRecords(payload, surface.label)
    .flatMap((value) => {
      const observation = observationFromCatalogRow(value);
      return observation ? [observation] : [];
    });
  return asResult(projectLiveModelObservations(surface, observations));
}
/** Parse the account-specific Codex manifest; web-only Instant/Thinking/Pro variants are excluded. */
export function parseChatGptAccountCatalog(payload: unknown): ParsedLiveCatalog {
  const root = record(payload);
  const values = Array.isArray(root.models) ? root.models : [];
  return asResult(values.flatMap((candidate): CatalogModelContribution[] => {
    const value = record(candidate);
    const id = text(value.slug) ?? text(value.id);
    const identity = liveIdentity(value, id);
    const isSpark = identity?.id === CHATGPT_SPARK_MODEL_ID;
    if (
      !id
      || !identity
      || (value.supported_in_api === false && !isSpark)
      || (text(value.visibility) && text(value.visibility) !== 'list')
      || /(?:^|-)pro$/i.test(id)
      || /(?:auto-review|compaction)/i.test(id)
    ) return [];
    const contextWindow = positiveInteger(value.context_window);
    const maxContextWindow = positiveInteger(value.max_context_window);
    const supportsOneMillion = Boolean(maxContextWindow && maxContextWindow >= 1_000_000);
    const effectiveContextWindow = contextWindow;
    const contextTiers: NonNullable<CatalogModelContribution['contextTiers']> = [{
      id: 'default',
      label: 'Codex service limit',
      ...(effectiveContextWindow ? { maxPromptTokens: effectiveContextWindow } : {}),
      activation: { kind: 'implicit' },
      entitlement: 'granted',
    }];
    if (supportsOneMillion && contextWindow && maxContextWindow && maxContextWindow > contextWindow) {
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
      modelId: identity.id,
      ...(identity.aliases.length > 0 ? { aliases: identity.aliases } : {}),
      label: text(value.display_name) ?? text(value.name) ?? id,
      availability: 'available',
      route: { protocol: 'OpenAIResponses', baseUrl: 'https://chatgpt.com/backend-api/codex', source: 'model' },
      contextTiers,
      ...(effectiveContextWindow ? { defaultBudgetTokens: effectiveContextWindow } : {}),
      toolCalling: { state: 'supported' },
      visionInput: isSpark
        ? { state: 'unsupported' }
        : inputModalities.length === 0
        ? { state: 'unknown' }
        : capabilityState(inputModalities.includes('image')),
      structuredOutput: { state: 'supported' },
    }];
  }));
}

/** The Anthropic model endpoint is authoritative for account-visible ids, not for undocumented limits. */
export function parseClaudeAccountCatalog(payload: unknown): ParsedLiveCatalog {
  return asResult(records(payload).flatMap((value): CatalogModelContribution[] => {
    const identity = liveIdentity(value);
    if (!identity) return [];
    return [{
      modelId: identity.id,
      ...(identity.aliases.length > 0 ? { aliases: identity.aliases } : {}),
      label: text(value.display_name) ?? text(value.label) ?? identity.id,
      availability: 'available',
      route: { protocol: 'AnthropicMessages', baseUrl: 'https://api.anthropic.com/v1', source: 'model' },
    }];
  }));
}

/** Parse OpenCode Go observations; the compiled surface owns exact model contracts. */
export function parseOpenCodeGoCatalog(
  payload: unknown,
  surface: ProviderSurfaceDefinition,
): ParsedLiveCatalog {
  const observations = strictCatalogRecords(payload, surface.label)
    .flatMap((value) => {
      const observation = observationFromCatalogRow(value);
      return observation ? [observation] : [];
    });
  return asResult(projectLiveModelObservations(surface, observations));
}
function hasClinePass(value: Record<string, unknown>): boolean {
  const entitlement = text(value.entitlement)?.toLowerCase();
  const groups = Array.isArray(value.groups) ? value.groups.map((entry) => text(entry)?.toLowerCase()) : [];
  return entitlement === 'clinepass' || entitlement === 'cline-pass' || groups.includes('clinepass') || groups.includes('cline-pass');
}

/** ClinePass is entitlement evidence only when the catalog says so explicitly. */
export function parseClineCatalog(payload: unknown): ParsedLiveCatalog {
  const contributions: CatalogModelContribution[] = [];
  const entitlementContributions: CatalogModelContribution[] = [];
  for (const value of records(payload)) {
    const identity = liveIdentity(value);
    if (!identity) continue;
    contributions.push({
      modelId: identity.id,
      ...(identity.aliases.length > 0 ? { aliases: identity.aliases } : {}),
      label: text(value.label) ?? text(value.name) ?? identity.id,
      availability: 'available',
      route: { protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://api.cline.bot/api/v1', source: 'catalog' },
      contextTiers: [{
        id: 'default',
        label: 'Default',
        maxPromptTokens: contextTokens(value),
        activation: { kind: 'implicit' },
        entitlement: 'unknown',
      }],
    });
    if (hasClinePass(value)) {
      entitlementContributions.push({
        modelId: identity.id,
        contextTiers: [{ id: 'default', label: 'ClinePass', entitlement: 'granted' }],
      });
    }
  }
  return asResult(contributions, entitlementContributions);
}

/**
 * FreeModel exposes two credential-scoped catalogs on separate hosts. Keep the
 * host/protocol join explicit so a Claude id can never fall through to the
 * OpenAI endpoint (or vice versa).
 */
export function parseFreeModelCatalog(openAiPayload: unknown, claudePayload: unknown): ParsedLiveCatalog {
  const parse = (
    payload: unknown,
    kind: 'openai' | 'anthropic',
  ): CatalogModelContribution[] => records(payload).flatMap((value): CatalogModelContribution[] => {
    const identity = liveIdentity(value);
    if (!identity) return [];
    const id = identity.id;
    if (kind === 'openai') {
      const chatRoute = {
        protocol: 'OpenAICompatibleChatCompletions' as const,
        baseUrl: 'https://api.freemodel.dev/v1',
        source: 'model' as const,
      };
      const responsesRoute = {
        protocol: 'OpenAIResponses' as const,
        baseUrl: 'https://api.freemodel.dev/v1',
        source: 'model' as const,
      };
      return [{
        modelId: id,
        ...(identity.aliases.length ? { aliases: identity.aliases } : {}),
        label: text(value.name) ?? text(value.display_name) ?? id,
        availability: 'available',
        route: chatRoute,
        routeOptions: [
          {
            id: 'OpenAICompatibleChatCompletions', route: chatRoute, availability: 'available',
            protocolOwner: 'openai', endpointOwner: 'freemodel', authMode: 'api-key',
          },
          {
            id: 'OpenAIResponses', route: responsesRoute, availability: 'unknown',
            protocolOwner: 'openai', endpointOwner: 'freemodel', authMode: 'api-key',
          },
        ],
      }];
    }
    const route = {
      protocol: 'AnthropicMessages' as const,
      baseUrl: 'https://cc.freemodel.dev/v1',
      source: 'model' as const,
    };
    return [{
      modelId: id,
      ...(identity.aliases.length ? { aliases: identity.aliases } : {}),
      label: text(value.name) ?? text(value.display_name) ?? id,
      availability: 'available',
      route,
      routeOptions: [{
        id: 'AnthropicMessages', route, availability: 'available',
        protocolOwner: 'anthropic', endpointOwner: 'freemodel', authMode: 'api-key',
      }],
    }];
  });
  return asResult([...parse(openAiPayload, 'openai'), ...parse(claudePayload, 'anthropic')]);
}

/** Parse the models visible to the API key minted by OpenRouter PKCE. */
/** Parse account-visible OpenRouter observations without attaching model-specific product controls. */
export function parseOpenRouterAccountCatalog(
  payload: unknown,
  surface: ProviderSurfaceDefinition,
): ParsedLiveCatalog {
  const observations = strictCatalogRecords(payload, surface.label).flatMap((value): LiveModelObservation[] => {
    const identity = liveIdentity(value);
    if (!identity) return [];
    const supportedParameters = Array.isArray(value.supported_parameters)
      ? value.supported_parameters.map((entry) => text(entry)?.toLowerCase()).filter(Boolean)
      : [];
    const inputModalities = Array.isArray(record(value.architecture).input_modalities)
      ? (record(value.architecture).input_modalities as unknown[])
        .map((entry) => text(entry)?.toLowerCase())
        .filter(Boolean)
      : [];
    return [{
      modelId: identity.id,
      ...(identity.aliases.length ? { aliases: identity.aliases } : {}),
      upstreamLabel: text(value.name),
      availability: 'available',
      contextWindowTokens: contextTokens(value),
      toolCalling: supportedParameters.includes('tools') ? { state: 'supported' } : { state: 'unknown' },
      visionInput: inputModalities.length === 0
        ? { state: 'unknown' }
        : capabilityState(inputModalities.includes('image')),
      structuredOutput: supportedParameters.includes('response_format')
        || supportedParameters.includes('structured_outputs')
        ? { state: 'supported' }
        : { state: 'unknown' },
    }];
  });
  return asResult(projectLiveModelObservations(surface, observations));
}
/** Grok account discovery contributes availability and context facts; the OAuth proxy route remains manifest-owned. */
export function parseGrokAccountCatalog(payload: unknown): ParsedLiveCatalog {
  const contributions = records(payload).flatMap((value): CatalogModelContribution[] => {
    const identity = liveIdentity(value);
    if (!identity) return [];
    return [{
      modelId: identity.id,
      ...(identity.aliases.length > 0 ? { aliases: identity.aliases } : {}),
      label: text(value.label) ?? identity.id,
      availability: 'available',
      contextTiers: [{
        id: 'default', label: 'Default', maxPromptTokens: contextTokens(value),
        activation: { kind: 'implicit' }, entitlement: 'granted',
      }],
      ...(contextTokens(value) ? { defaultBudgetTokens: contextTokens(value) } : {}),
      toolCalling: capabilityState(record(value.capabilities).tool_calls),
      visionInput: capabilityState(record(value.capabilities).vision),
      structuredOutput: capabilityState(record(value.capabilities).structured_output),
    }];
  });
  return asResult(contributions);
}

/** Parse Builder observations; the compiled Grok surface owns identity, route, controls, and bindings. */
export function parseGrokBuilderCatalog(
  payload: unknown,
  surface: ProviderSurfaceDefinition,
): ParsedLiveCatalog {
  const root = record(payload);
  const envelope = (() => {
    if (Array.isArray(payload)) {
      return { kind: 'root-array' as const, candidates: payload };
    }
    for (const key of ['models', 'data', 'items'] as const) {
      const value = root[key];
      if (Array.isArray(value)) {
        return {
          kind: (key + '-array') as 'models-array' | 'data-array' | 'items-array',
          candidates: value,
        };
      }
      if (key === 'models') {
        const modelMap = record(value);
        if (Object.keys(modelMap).length > 0) {
          const candidates = Object.entries(modelMap).map(([id, candidate]) => {
            const wrapper = record(candidate);
            const info = record(wrapper.info);
            if (text(info.id) || text(wrapper.id)) return candidate;
            return Object.keys(info).length > 0
              ? { ...wrapper, info: { ...info, id } }
              : { ...wrapper, id };
          });
          return { kind: 'models-map' as const, candidates };
        }
      }
    }
    return { kind: 'unknown' as const, candidates: [] };
  })();
  const filtered = { invalidIdentity: 0, hidden: 0, unsupportedInApi: 0 };
  const observations = envelope.candidates.flatMap((candidate): LiveModelObservation[] => {
    const wrapper = record(candidate);
    const info = record(wrapper.info);
    const value = Object.keys(info).length > 0 ? info : wrapper;
    const observation = observationFromCatalogRow(value);
    if (!observation) {
      filtered.invalidIdentity += 1;
      return [];
    }
    if (value.hidden === true) {
      filtered.hidden += 1;
      return [];
    }
    if (value.supported_in_api === false) {
      filtered.unsupportedInApi += 1;
      return [];
    }
    return [observation];
  });
  const contributions = projectLiveModelObservations(surface, observations);
  return {
    ...asResult(contributions),
    diagnostic: {
      envelopeKind: envelope.kind,
      candidateCount: envelope.candidates.length,
      admittedCount: contributions.length,
      filtered,
    },
  };
}
