import type { LlmProviderEntry } from '../types/settings';

/** A saved connection's identity, shared by settings writes and catalog readers. */
export function providerConnectionIdentity(provider: LlmProviderEntry): string {
  return JSON.stringify([
    provider.id,
    provider.activeAccountId,
    provider.protocol,
    provider.authMode,
    provider.configuredAuthMode,
    provider.baseUrl,
    provider.isConfigured,
    provider.hasStoredSecret,
    Object.entries(provider.connectionValues ?? {}).sort(([left], [right]) => left.localeCompare(right)),
    Object.entries(provider.hasStoredConnectionSecrets ?? {}).sort(([left], [right]) => left.localeCompare(right)),
  ]);
}
