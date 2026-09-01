import type { LlmProviderId } from '@shared/types/settings';
import { loadProviderSurface } from '../provider-catalog/ProviderCatalogRegistry';
import { providerAccountAuthService } from './ProviderAccountAuthService';
import {
  providerRuntimeCredentialService,
  type ProviderRuntimeCredentialOperation,
} from './ProviderRuntimeCredentialService';
import { settingsService } from './SettingsService';

export interface FrozenProviderRuntimeCredentialLease {
  handle: string;
  operation: ProviderRuntimeCredentialOperation;
  accountCredentialsRefreshed: boolean;
}

/**
 * Shared credential freeze barrier for every real provider execution path.
 * The returned handle is opaque and must be released by the caller.
 */
export async function freezeProviderRuntimeCredentials(
  providerId: LlmProviderId,
  operation: ProviderRuntimeCredentialOperation = 'chat',
): Promise<FrozenProviderRuntimeCredentialLease> {
  const surface = await loadProviderSurface(providerId);
  if (!surface) throw new Error(`Provider Catalog surface ${providerId} is unavailable.`);

  const provider = settingsService.getAll().llm.providers.find((entry) => entry.id === providerId);
  const accountCredentialsRefreshed = provider?.authMode === 'account';
  if (accountCredentialsRefreshed) {
    await providerAccountAuthService.ensureRuntimeCredentials(providerId);
  }

  return {
    handle: await providerRuntimeCredentialService.freeze(providerId, operation),
    operation,
    accountCredentialsRefreshed,
  };
}

export function releaseProviderRuntimeCredentials(handle: string | undefined): void {
  providerRuntimeCredentialService.release(handle);
}
