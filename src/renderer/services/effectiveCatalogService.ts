import type { EffectiveCatalogSnapshot } from '@shared/types/providerCapability';
import type { ElectronAPI } from '@shared/types/electron';

export async function readEffectiveCatalog(api: ElectronAPI | undefined, providerId: string, accountId: string): Promise<EffectiveCatalogSnapshot | null> {
  if (!api) throw new Error('The application bridge is unavailable.');
  return api.settings.getEffectiveCatalog(providerId, accountId);
}

export function observeEffectiveCatalog(api: ElectronAPI | undefined, listener: (snapshot: EffectiveCatalogSnapshot) => void): () => void {
  return api?.events.onEffectiveCatalogChanged(listener) ?? (() => undefined);
}
