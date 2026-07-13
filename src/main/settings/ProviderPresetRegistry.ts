import type { SeedModelDefinition, ProviderPreset } from '@shared/types/providerCapability';
import type {
  BuiltinLlmProviderId,
  LlmProviderAuthMode,
  LlmProviderAvailability,
  LlmProviderCatalogOwnership,
  LlmProviderEntry,
  LlmProviderModel,
  LlmProviderModelDiscoveryStrategy,
  LlmProviderProtocol,
} from '@shared/types/settings';
import { PROVIDER_PRESETS } from './presets';

const presetById = new Map(PROVIDER_PRESETS.map((preset) => [preset.id, preset]));

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertSerializablePreset(preset: ProviderPreset): void {
  const visit = (value: unknown, path: string, seen: Set<object>): void => {
    if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint' || value === undefined) {
      throw new Error(`Provider preset ${preset.id} is not JSON-serializable at ${path}.`);
    }
    if (!value || typeof value !== 'object') return;
    if (seen.has(value)) throw new Error(`Provider preset ${preset.id} contains a cycle at ${path}.`);
    seen.add(value);
    if (Array.isArray(value)) value.forEach((entry, index) => visit(entry, `${path}[${index}]`, seen));
    else Object.entries(value).forEach(([key, entry]) => visit(entry, `${path}.${key}`, seen));
    seen.delete(value);
  };
  visit(preset, '$', new Set());
  JSON.stringify(preset);
}

for (const preset of PROVIDER_PRESETS) {
  assertSerializablePreset(preset);
  if (preset.schemaVersion !== 1) throw new Error(`Unsupported provider preset schema: ${preset.id}`);
}

function defaultRoute(preset: ProviderPreset) {
  return preset.routes.find((route) => route.default) ?? preset.routes[0];
}

function toAuthMode(preset: ProviderPreset): LlmProviderAuthMode {
  const mode = preset.authModes[0];
  if (mode === 'oauth' || mode === 'device') return 'account';
  if (mode === 'environment' || mode === 'local') return mode;
  return 'api-key';
}

function mapPresetAuthMode(mode: ProviderPreset['authModes'][number]): LlmProviderAuthMode {
  if (mode === 'oauth' || mode === 'device') return 'account';
  if (mode === 'environment' || mode === 'local') return mode;
  return 'api-key';
}

function combineAvailability(
  provider: ProviderPreset['availability'],
  mode: ProviderPreset['availability'],
): LlmProviderAvailability {
  const states = [provider.state, mode.state];
  const state = states.includes('unavailable')
    ? 'unavailable'
    : states.includes('unknown')
      ? 'unknown'
      : 'available';
  const reason = [provider.reason, mode.reason]
    .filter((value): value is string => Boolean(value?.trim()))
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(' ');
  return { state, ...(reason ? { reason } : {}) };
}

export function getProviderPresetAuthModeAvailability(
  id: string,
): Partial<Record<LlmProviderAuthMode, LlmProviderAvailability>> {
  const preset = presetById.get(id);
  if (!preset) return {};
  const grouped = new Map<LlmProviderAuthMode, ProviderPreset['authModes']>();
  for (const rawMode of preset.authModes) {
    const mode = mapPresetAuthMode(rawMode);
    grouped.set(mode, [...(grouped.get(mode) ?? []), rawMode]);
  }
  return Object.fromEntries([...grouped.entries()].map(([mode, rawModes]) => {
    const rawAvailability = rawModes.map((rawMode) => preset.authModeAvailability?.[rawMode] ?? preset.availability);
    const modeAvailability = rawAvailability.some((entry) => entry.state === 'available')
      ? { state: 'available' as const }
      : rawAvailability.some((entry) => entry.state === 'unknown')
        ? {
            state: 'unknown' as const,
            reason: rawAvailability.find((entry) => entry.state === 'unknown')?.reason,
          }
        : {
            state: 'unavailable' as const,
            reason: rawAvailability.map((entry) => entry.reason).filter(Boolean).join(' '),
          };
    return [mode, combineAvailability(preset.availability, modeAvailability)];
  }));
}

function toAuthModeOptions(preset: ProviderPreset): LlmProviderAuthMode[] {
  return [...new Set(preset.authModes.map(mapPresetAuthMode))];
}

function toLegacyDiscovery(preset: ProviderPreset): LlmProviderModelDiscoveryStrategy | null {
  if (!preset.discovery) return null;
  if (preset.discovery.kind === 'custom-parser') {
    return preset.discovery.parserId as LlmProviderModelDiscoveryStrategy;
  }
  const protocol = defaultRoute(preset)?.protocol;
  if (protocol === 'GoogleGemini') return 'google-ai-studio';
  if (protocol === 'AnthropicMessages') return 'anthropic-candidate-validation';
  if (protocol === 'OllamaOpenAICompatibleChatCompletions') return 'ollama-tags';
  return 'openai-compatible';
}

function toProviderModel(seed: SeedModelDefinition): LlmProviderModel {
  return {
    id: seed.modelId,
    label: seed.label,
    enabled: seed.availability !== 'unavailable',
    ...(seed.aliases.length > 0 ? { aliases: [...seed.aliases] } : {}),
    availability: seed.availability,
    availabilityReason: seed.unavailableReason,
  };
}

export function listProviderPresets(): ProviderPreset[] {
  return PROVIDER_PRESETS.map(cloneJson);
}

export function getProviderPreset(id: string): ProviderPreset | null {
  const preset = presetById.get(id);
  return preset ? cloneJson(preset) : null;
}

export function isBuiltinProviderId(id: string): id is BuiltinLlmProviderId {
  return presetById.has(id);
}

export function getProviderPresetCatalogOwnership(id: string): LlmProviderCatalogOwnership {
  return presetById.get(id)?.catalogOwnership ?? 'user-managed';
}

export function getProviderSeedModels(id: string): LlmProviderModel[] {
  return (presetById.get(id)?.seedModels ?? []).map(toProviderModel);
}

export function getProviderSeedModelDefinitions(id: string): SeedModelDefinition[] {
  return cloneJson(presetById.get(id)?.seedModels ?? []);
}

export function lookupProviderSeedModel(id: string, modelId: string): SeedModelDefinition | null {
  const normalized = modelId.trim().toLowerCase();
  const seed = presetById.get(id)?.seedModels.find((model) => (
    model.modelId.trim().toLowerCase() === normalized
    || model.aliases.some((alias) => alias.trim().toLowerCase() === normalized)
  ));
  return seed ? cloneJson(seed) : null;
}

export function getProviderPresetProtocolOptions(id: string): LlmProviderProtocol[] {
  return [...(presetById.get(id)?.routes.map((route) => route.protocol) ?? [])];
}

export function getProviderPresetProtocolBaseUrls(id: string): Partial<Record<LlmProviderProtocol, string>> | undefined {
  const preset = presetById.get(id);
  if (!preset) return undefined;
  const entries = preset.routes
    .filter((route) => Boolean(route.baseUrl?.trim()))
    .map((route) => [route.protocol, route.baseUrl] as const);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function resolveProviderPresetProtocol(id: string, candidate: unknown): LlmProviderProtocol | null {
  const preset = presetById.get(id);
  const fallback = preset ? defaultRoute(preset) : undefined;
  if (!preset || !fallback) return null;
  return preset.userSelectableRoute && typeof candidate === 'string'
    && preset.routes.some((route) => route.protocol === candidate)
    ? candidate as LlmProviderProtocol
    : fallback.protocol;
}

export function resolveProviderPresetBaseUrl(id: string, protocol: LlmProviderProtocol): string | undefined {
  const preset = presetById.get(id);
  const route = preset?.routes.find((entry) => entry.protocol === protocol) ?? (preset ? defaultRoute(preset) : undefined);
  return route?.baseUrl?.trim().replace(/\/+$/, '');
}

export function resolveBaseUrlForProtocolChange(
  id: string,
  previousProtocol: LlmProviderProtocol,
  nextProtocol: LlmProviderProtocol,
  currentBaseUrl: string | undefined,
): string {
  const previousDefault = resolveProviderPresetBaseUrl(id, previousProtocol) ?? '';
  const nextDefault = resolveProviderPresetBaseUrl(id, nextProtocol) ?? '';
  const current = (currentBaseUrl ?? '').trim().replace(/\/+$/, '');
  return !current || current === previousDefault ? nextDefault || current : currentBaseUrl?.trim() ?? current;
}

export function createProviderEntryFromPreset(id: BuiltinLlmProviderId): LlmProviderEntry {
  const preset = presetById.get(id);
  const route = preset ? defaultRoute(preset) : undefined;
  if (!preset || !route) throw new Error(`Unknown builtin provider: ${id}`);
  const models = preset.catalogOwnership === 'app-managed' ? preset.seedModels.map(toProviderModel) : [];
  const authMode = toAuthMode(preset);
  const authModeAvailability = getProviderPresetAuthModeAvailability(id);
  const selectedAvailability = authModeAvailability[authMode] ?? preset.availability;
  const unavailableReason = selectedAvailability.state === 'unavailable' ? selectedAvailability.reason : undefined;
  const credentialless = authMode === 'local' || authMode === 'environment';
  return {
    id,
    protocol: route.protocol,
    authMode,
    authModeOptions: toAuthModeOptions(preset),
    authModeAvailability,
    hasStoredSecretByAuthMode: credentialless ? { [authMode]: true } : {},
    lifecycleStatus: preset.status,
    providerAvailability: { ...preset.availability },
    category: preset.category,
    catalogOwnership: preset.catalogOwnership,
    modelDiscovery: toLegacyDiscovery(preset),
    label: preset.label,
    enabled: false,
    apiKey: '',
    hasStoredSecret: !unavailableReason && credentialless,
    baseUrl: route.baseUrl,
    baseUrlEditable: preset.baseUrlEditable,
    protocolEditable: preset.userSelectableRoute,
    protocolOptions: preset.routes.map((entry) => entry.protocol),
    protocolBaseUrls: getProviderPresetProtocolBaseUrls(id),
    models,
    recommendedModels: models.length > 0 ? models.map((model) => model.id) : [...preset.recommendedModels],
    docsUrl: preset.docsUrl,
    status: unavailableReason ? 'unavailable' : 'unconfigured',
    accountLoginConfigured: preset.accountLoginConfigured,
    unavailableReason,
    isConfigured: false,
    capabilities: preset.capabilities ? [...preset.capabilities] : undefined,
  };
}

export function createProviderEntriesFromPresets(): LlmProviderEntry[] {
  return PROVIDER_PRESETS.map((preset) => createProviderEntryFromPreset(preset.id as BuiltinLlmProviderId));
}
