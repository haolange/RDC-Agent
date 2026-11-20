import type { LlmProviderId } from '@shared/types/settings';
import { getLoadedProviderSurface } from '../../../provider-catalog/ProviderCatalogRegistry';

export interface AccountRoute {
  baseUrl: string;
  headers: Readonly<Record<string, string>>;
}

/**
 * The loaded surface's default route: the base URL and fixed headers that account catalog calls share
 * with inference requests. Callers load the surface first; an unloaded one is a programming error.
 */
export function accountDefaultRoute(providerId: LlmProviderId): AccountRoute {
  const surface = getLoadedProviderSurface(providerId);
  const route = surface?.routes.find((candidate) => candidate.default) ?? surface?.routes[0];
  if (!route) throw new Error(`Provider surface ${providerId} is not loaded.`);
  return { baseUrl: route.baseUrl.replace(/\/+$/, ''), headers: { ...(route.headers ?? {}) } };
}
