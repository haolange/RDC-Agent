import { AppError } from '@shared/errors/appError';
import type { EffectiveCatalogChange, EffectiveCatalogSnapshot } from '@shared/types/providerCapability';
import type { ElectronAPI } from '@shared/types/electron';
import type { LlmProviderProtocol } from '@shared/types/settings';

export async function readEffectiveCatalog(
  api: ElectronAPI | undefined,
  providerId: string,
  accountId: string,
): Promise<EffectiveCatalogSnapshot | null> {
  if (!api) throw new Error('The application bridge is unavailable.');
  return api.settings.getEffectiveCatalog(providerId, accountId);
}

export async function refreshEffectiveCatalog(
  api: ElectronAPI | undefined,
  providerId: string,
  scope: { accountId: string; protocol: LlmProviderProtocol },
): Promise<void> {
  if (!api) throw new Error('The application bridge is unavailable.');
  const result = await api.llm.refreshProviderModels(providerId, scope);
  // The connection result keeps its own technical text; the failure carries a code humanizeError can word.
  if (!result.success) throw new AppError('PROVIDER_CONNECTION_FAILED', result.error);
}

export function observeEffectiveCatalog(
  api: ElectronAPI | undefined,
  listener: (change: EffectiveCatalogChange) => void,
): () => void {
  return api?.events.onEffectiveCatalogChanged(listener) ?? (() => undefined);
}
