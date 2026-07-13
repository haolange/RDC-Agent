import type {
  CatalogLayerContribution,
  CatalogModelContribution,
} from './EffectiveCatalogService';
import type {
  ModelRoute,
  ProviderCapabilityOverlay,
} from '@shared/types/providerCapability';
import type { LlmProviderProtocol } from '@shared/types/settings';

export function resolveModelRoutePrecedence(input: {
  modelRoute?: ModelRoute;
  userRoute?: Omit<ModelRoute, 'source'>;
  presetRoute: Omit<ModelRoute, 'source'>;
}): ModelRoute {
  if (input.modelRoute) return { ...input.modelRoute, source: 'model' };
  if (input.userRoute) return { ...input.userRoute, source: 'user' };
  return { ...input.presetRoute, source: 'preset' };
}

export function projectProtocolOverlays(
  overlays: ProviderCapabilityOverlay[],
  protocol: LlmProviderProtocol,
  observedAt: string,
): CatalogLayerContribution | undefined {
  const models = overlays
    .filter((overlay) => !overlay.protocol || overlay.protocol === protocol)
    .map((overlay) => ({ modelId: overlay.modelId, ...overlay.patch })) as CatalogModelContribution[];
  return models.length > 0
    ? { source: 'overlay', protocol, observedAt, detail: `Capability overlay for ${protocol}`, models }
    : undefined;
}

export function isModelRouteLocked(route: ModelRoute): boolean {
  return route.source === 'model';
}
