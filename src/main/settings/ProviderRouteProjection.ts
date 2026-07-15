import type {
  CatalogLayerContribution,
  CatalogModelContribution,
} from './EffectiveCatalogService';
import type {
  ModelRoute,
  ProviderProtocolOverride,
} from '@shared/types/providerCapability';
import type { LlmProviderProtocol } from '@shared/types/settings';

export function resolveModelRoutePrecedence(input: {
  modelRoute?: ModelRoute;
  catalogRoute: Omit<ModelRoute, 'source'>;
}): ModelRoute {
  const withCatalogHeaders = <T extends Omit<ModelRoute, 'source'> | ModelRoute>(route: T): T => ({
    ...route,
    headers: {
      ...(input.catalogRoute.headers ?? {}),
      ...(route.headers ?? {}),
    },
  });
  if (input.modelRoute) return { ...withCatalogHeaders(input.modelRoute), source: 'model' };
  return { ...input.catalogRoute, source: 'catalog' };
}

export function projectModelProtocolOverlays(
  overlays: ProviderProtocolOverride[],
  defaultProtocol: LlmProviderProtocol,
  preferredProtocols: ReadonlyMap<string, LlmProviderProtocol>,
  observedAt: string,
): CatalogLayerContribution | undefined {
  const models = overlays
    .filter((overlay) => (
      !overlay.protocol
      || overlay.protocol === (preferredProtocols.get(overlay.modelId) ?? defaultProtocol)
    ))
    .map((overlay) => ({ modelId: overlay.modelId, ...overlay.patch })) as CatalogModelContribution[];
  return models.length > 0
    ? {
        source: 'overlay',
        protocol: defaultProtocol,
        observedAt,
        detail: 'Capability overlay resolved per selected model route',
        models,
      }
    : undefined;
}

export function isModelRouteLocked(route: ModelRoute): boolean {
  return route.source === 'model';
}
