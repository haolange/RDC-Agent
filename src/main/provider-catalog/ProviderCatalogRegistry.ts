import bundledCatalogIndex, {
  loadProviderSurface as loadCompiledProviderSurface,
} from 'virtual:rdc-provider-catalog-index';
import type { ModelManifest } from '@shared/provider-catalog/modelManifestSchema';
import { ProviderSurfaceManifestSchema, type ProviderSurfaceManifest } from '@shared/provider-catalog/catalogManifestSchema';
import {
  type CompiledProviderCatalogIndex,
  type CompiledProviderSurface,
  type ProviderSurfaceSummary,
} from '@shared/provider-catalog/compiler';
import type {
  BuiltinLlmProviderId,
  LlmProviderAuthMode,
  LlmProviderAvailability,
  LlmProviderCatalogOwnership,
  LlmProviderEntry,
  LlmProviderModel,
} from '@shared/types/settings';

const loadedSurfaces = new Map<string, ProviderSurfaceManifest>();
const surfaceLoads = new Map<string, Promise<ProviderSurfaceManifest>>();

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isCompiledIndex(value: unknown): value is CompiledProviderCatalogIndex {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CompiledProviderCatalogIndex>;
  return candidate.schemaVersion === 1
    && typeof candidate.catalogRevision === 'string'
    && Array.isArray(candidate.surfaces)
    && typeof candidate.identityCount === 'number'
    && typeof candidate.surfaceCount === 'number'
    && typeof candidate.modelCount === 'number';
}

if (!isCompiledIndex(bundledCatalogIndex)) {
  throw new Error('Bundled Provider Catalog index is invalid.');
}

function loadCatalogIndex(): CompiledProviderCatalogIndex {
  return bundledCatalogIndex;
}

function parseCompiledSurface(raw: unknown, expectedRevision: string): ProviderSurfaceManifest {
  if (!raw || typeof raw !== 'object') throw new Error('Compiled Provider surface is invalid.');
  const artifact = raw as Partial<CompiledProviderSurface>;
  if (artifact.schemaVersion !== 1 || artifact.catalogRevision !== expectedRevision) {
    throw new Error('Compiled Provider surface revision does not match the Catalog index.');
  }
  return ProviderSurfaceManifestSchema.parse(artifact.surface);
}

function defaultRoute(surface: Pick<ProviderSurfaceManifest, 'routes'>) {
  return surface.routes.find((route) => route.default) ?? surface.routes[0];
}

function summaryById(id: string): ProviderSurfaceSummary | undefined {
  return loadCatalogIndex().surfaces.find((surface) => surface.id === id);
}

function mapAuthMode(mode: ProviderSurfaceManifest['authModes'][number]): LlmProviderAuthMode {
  if (mode === 'oauth' || mode === 'device') return 'account';
  if (mode === 'none') return 'none';
  if (mode === 'environment' || mode === 'local') return mode;
  return 'api-key';
}

function toAuthModeOptions(surface: Pick<ProviderSurfaceManifest, 'authModes'>): LlmProviderAuthMode[] {
  return [...new Set(surface.authModes.map(mapAuthMode))];
}

function combineAvailability(
  provider: ProviderSurfaceManifest['availability'],
  mode: ProviderSurfaceManifest['availability'],
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

function toProviderModel(model: ProviderSurfaceSummary['models'][number] | ModelManifest): LlmProviderModel {
  const availability = model.presencePolicy === 'account-entitled' && model.availability === 'available'
    ? 'unknown'
    : model.availability;
  return {
    id: model.modelId,
    label: model.label,
    enabled: availability !== 'unavailable',
    ...(model.aliases.length > 0 ? { aliases: [...model.aliases] } : {}),
    availability,
    availabilityReason: availability === 'unavailable' ? model.unavailableReason : undefined,
  };
}

export function getProviderCatalogRevision(): string {
  return loadCatalogIndex().catalogRevision;
}

export function listProviderSummaries(): ProviderSurfaceSummary[] {
  return cloneJson(loadCatalogIndex().surfaces);
}

export function getProviderSurfaceSummary(id: string): ProviderSurfaceSummary | null {
  const summary = summaryById(id);
  return summary ? cloneJson(summary) : null;
}

export async function loadProviderSurface(id: string): Promise<ProviderSurfaceManifest | null> {
  const cached = loadedSurfaces.get(id);
  if (cached) return cloneJson(cached);
  const active = surfaceLoads.get(id);
  if (active) return cloneJson(await active);
  if (!summaryById(id)) return null;
  const index = loadCatalogIndex();
  const load = loadCompiledProviderSurface(id).then((surface) => {
    if (!surface) throw new Error(`Bundled Provider surface ${id} is missing.`);
    return parseCompiledSurface(surface, index.catalogRevision);
  });
  surfaceLoads.set(id, load);
  try {
    const surface = await load;
    loadedSurfaces.set(id, surface);
    return cloneJson(surface);
  } finally {
    surfaceLoads.delete(id);
  }
}

export function getLoadedProviderSurface(id: string): ProviderSurfaceManifest | null {
  const surface = loadedSurfaces.get(id);
  return surface ? cloneJson(surface) : null;
}

export function isBuiltinProviderId(id: string): id is BuiltinLlmProviderId {
  return Boolean(summaryById(id));
}

export function getProviderCatalogOwnership(id: string): LlmProviderCatalogOwnership {
  return summaryById(id)?.catalogOwnership ?? 'user-managed';
}

export function getProviderDiscoveryAuthority(
  id: string,
): ProviderSurfaceSummary['discoveryAuthority'] | undefined {
  return summaryById(id)?.discoveryAuthority;
}
export function getProviderAuthModeAvailability(
  id: string,
): Partial<Record<LlmProviderAuthMode, LlmProviderAvailability>> {
  const surface = summaryById(id);
  if (!surface) return {};
  const grouped = new Map<LlmProviderAuthMode, ProviderSurfaceManifest['authModes']>();
  for (const rawMode of surface.authModes) {
    const mode = mapAuthMode(rawMode);
    grouped.set(mode, [...(grouped.get(mode) ?? []), rawMode]);
  }
  return Object.fromEntries([...grouped.entries()].map(([mode, rawModes]) => {
    const rawAvailability = rawModes.map((rawMode) => surface.authModeAvailability?.[rawMode] ?? surface.availability);
    const modeAvailability = rawAvailability.some((entry) => entry.state === 'available')
      ? { state: 'available' as const }
      : rawAvailability.some((entry) => entry.state === 'unknown')
        ? { state: 'unknown' as const, reason: rawAvailability.find((entry) => entry.state === 'unknown')?.reason }
        : { state: 'unavailable' as const, reason: rawAvailability.map((entry) => entry.reason).filter(Boolean).join(' ') };
    return [mode, combineAvailability(surface.availability, modeAvailability)];
  }));
}

export function getProviderModelSummaries(id: string): LlmProviderModel[] {
  const summary = summaryById(id);
  return summary?.models
    .filter((model) => model.selection.pickerVisibility !== 'internal')
    .map(toProviderModel) ?? [];
}

export function getProviderCatalogModelSummaries(id: string): ProviderSurfaceSummary['models'] {
  return cloneJson(summaryById(id)?.models ?? []);
}


export function getProviderModelDefinitions(id: string): ModelManifest[] {
  return cloneJson(loadedSurfaces.get(id)?.models ?? []);
}

export function lookupProviderModelDefinition(id: string, modelId: string): ModelManifest | null {
  const normalized = modelId.trim().toLowerCase();
  const model = loadedSurfaces.get(id)?.models.find((entry) => (
    entry.modelId.trim().toLowerCase() === normalized
    || entry.aliases.some((alias) => alias.trim().toLowerCase() === normalized)
  ));
  return model ? cloneJson(model) : null;
}

export function getProviderDefaultBaseUrl(id: string): string | undefined {
  const surface = summaryById(id);
  const route = surface ? defaultRoute(surface) : undefined;
  return route?.baseUrl.trim().replace(/\/+$/, '');
}

export function createProviderEntryFromCatalog(id: string): LlmProviderEntry {
  const surface = summaryById(id);
  const route = surface ? defaultRoute(surface) : undefined;
  if (!surface || !route) throw new Error(`Unknown builtin provider: ${id}`);
  const models = surface.catalogOwnership !== 'user-managed'
    ? surface.models.filter((model) => model.selection.pickerVisibility !== 'internal'
      && (model.presencePolicy !== 'account-entitled' || model.availability === 'available')).map(toProviderModel)
    : [];
  const authMode = mapAuthMode(surface.authModes[0]);
  const authModeAvailability = getProviderAuthModeAvailability(id);
  const selectedAvailability = authModeAvailability[authMode] ?? surface.availability;
  const unavailableReason = selectedAvailability.state === 'unavailable' ? selectedAvailability.reason : undefined;
  const credentialless = authMode === 'none' || authMode === 'local' || authMode === 'environment';
  return {
    id,
    protocol: route.protocol,
    authMode,
    authModeOptions: toAuthModeOptions(surface),
    authModeAvailability,
    hasStoredSecretByAuthMode: credentialless ? { [authMode]: true } : {},
    lifecycleStatus: surface.status,
    providerAvailability: { ...surface.availability },
    category: surface.category,
    serviceOperator: surface.serviceOperator,
    endpointClass: surface.endpointClass,
    catalogOwnership: surface.catalogOwnership,
    catalogProvenance: surface.factSources.map((source) => ({
      source: source.sourceKind,
      revision: source.sourceRevision,
      observedAt: source.observedAt,
      refreshedAt: source.refreshedAt,
      identityId: source.identityId,
      surface: source.surface,
      accountScope: source.accountScope,
      surfaceBuild: source.surfaceBuild,
      plan: source.plan,
    })),
    label: surface.label,
    enabled: false,
    apiKey: '',
    hasStoredSecret: !unavailableReason && credentialless,
    secretRefs: {},
    connectionValues: {},
    connectionSchema: surface.connectionSchema ?? { fields: [] },
    baseUrl: route.baseUrl,
    baseUrlEditable: surface.baseUrlEditable,
    models,
    recommendedModels: models.length > 0 ? models.map((model) => model.id) : [...surface.recommendedModels],
    docsUrl: surface.docsUrl,
    status: unavailableReason ? 'unavailable' : 'unconfigured',
    accountLoginConfigured: surface.accountLoginConfigured,
    unavailableReason,
    isConfigured: false,
    capabilities: surface.capabilities ? [...surface.capabilities] : undefined,
  };
}

export function createProviderEntriesFromCatalog(): LlmProviderEntry[] {
  return listProviderSummaries().map((surface) => createProviderEntryFromCatalog(surface.id));
}

export const __testing = {
  getLoadedSurfaceIds() {
    return [...loadedSurfaces.keys()].sort();
  },
  getPendingSurfaceIds() {
    return [...surfaceLoads.keys()].sort();
  },
  reset() {
    loadedSurfaces.clear();
    surfaceLoads.clear();
  },
};
