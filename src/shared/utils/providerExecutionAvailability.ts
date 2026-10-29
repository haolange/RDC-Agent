import type { LlmProviderEntry } from '../types/settings';

/** Catalog contents never override the connection's current execution authority. */
export function isProviderExecutable(provider: Pick<LlmProviderEntry, 'enabled' | 'isConfigured'> | null | undefined): boolean {
  return provider?.enabled === true && provider.isConfigured === true;
}
