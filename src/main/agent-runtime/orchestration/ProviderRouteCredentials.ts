/**
 * ProviderRouteCredentials — credential leases for Agent routes. Freezing a provider's runtime credentials can refresh
 * its account credentials; the Agent model routes Settings assigns are then re-applied to the slots.
 */

import { settingsService } from '../../settings/settings-core/SettingsService';
import { compiledRoutesFromDefinitions } from '../../settings/provider-catalog/compiledAgentRoutes';
import { providerRuntimeCredentialService } from '../../settings/provider-auth/ProviderRuntimeCredentialService';
import { freezeProviderRuntimeCredentials } from '../../settings/provider-auth/ProviderRuntimeCredentialLease';
import type { LlmProviderId } from '@shared/types/settings';
import type { AgentSlotRegistry } from './AgentSlotRegistry';

export class ProviderRouteCredentials {
  constructor(private readonly slots: Pick<AgentSlotRegistry, 'applyLlmConfig'>) {}

  /** Re-reads the Agent model routes Settings assigns (after a settings or credential change). */
  applyLlmConfig(): void {
    this.slots.applyLlmConfig(compiledRoutesFromDefinitions([...settingsService.agentDefinitions()]));
  }

  /** Freezes the provider's runtime credentials and returns the lease handle. */
  async refresh(providerId: LlmProviderId): Promise<string> {
    const lease = await freezeProviderRuntimeCredentials(providerId);
    if (lease.accountCredentialsRefreshed) {
      this.applyLlmConfig();
    }
    return lease.handle;
  }

  release(credentialHandle: string | undefined): void {
    providerRuntimeCredentialService.release(credentialHandle);
  }
}
