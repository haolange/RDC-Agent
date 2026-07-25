import {
  getProviderAuthModeAvailability,
  isBuiltinProviderId,
} from '../provider-catalog/ProviderCatalogRegistry';
import type {
  LlmProviderAccountLoginFinishRequest,
  LlmProviderAccountLoginStartRequest,
  LlmProviderAccountStatus,
  LlmProviderAuthMode,
  LlmProviderConnectionResult,
  LlmProviderDraftRequest,
  LlmProviderEntry,
  LlmProviderId,
} from '@shared/types/settings';
import { settingsService } from '../settings/SettingsService';
import { providerAccountAuthService } from './ProviderAccountAuthService';
import {
  applyDiscoveryAuthority,
  refreshEffectiveCatalogDiscovery,
  toDiscoveryModelContributions,
} from './EffectiveModelResolver';
import type {
  DiscoveryLoader,
  EffectiveCatalogRequest,
} from './effectiveCatalogTypes';
import { parseProviderError, ProviderConnectionError } from './providerConnectionErrors';
import {
  resolveProviderConnectionDraft,
  resolveTestDiscoveryAccountId,
} from './ProviderConnectionDraft';
import { discoverProviderModels } from './ProviderModelDiscovery';

export {
  mergeManagedModelAvailability,
  normalizeDiscoveredModels,
  normalizeCodingPlanModelMatchKey,
  selectSupportedCodingPlanModels,
} from './providerConnectionModelUtils';
export {
  parseGoogleVertexPublisherModels,
  projectBedrockMantleModelRoutes,
  projectGoogleVertexModelRoutes,
  resolveBedrockResponsesBaseUrl,
  resolveClineCatalogUrl,
  resolveClineCredentialProbeUrl,
  resolveCodingPlanModelsUrl,
  resolveGoogleVertexOpenAiBaseUrl,
  resolveGoogleVertexPublisherModelsUrl,
  resolveVolcengineCodingPlanModelsUrl,
} from './providerConnectionUrls';
export { resolveProviderConnectionDraft, resolveTestDiscoveryAccountId } from './ProviderConnectionDraft';

export class ProviderConnectionService {
  constructor() {
    providerAccountAuthService.setCatalogPublisher(async (providerId, discovery) => {
      const provider = settingsService.getAll().llm.providers.find((entry) => entry.id === providerId);
      if (provider) {
        await refreshEffectiveCatalogDiscovery(
          provider,
          discovery.models,
          discovery.contributions,
          discovery.entitlementContributions,
          discovery.detail,
        );
      }
    });
  }

  createEffectiveCatalogDiscoveryLoader(request: EffectiveCatalogRequest): DiscoveryLoader | undefined {
    const provider = settingsService.getAll().llm.providers.find((entry) => entry.id === request.providerId);
    const accountId = provider?.activeAccountId ?? (provider ? `anonymous:${provider.id}` : '');
    if (
      !provider
      || !provider.isConfigured
      || provider.protocol !== request.protocol
      || accountId !== request.accountId
    ) {
      return undefined;
    }
    return async () => {
      const connection = provider.authMode === 'account'
        ? null
        : resolveProviderConnectionDraft(
            provider,
            {},
            settingsService.getProviderConnectionValues(provider.id),
          );
      const discovery = provider.authMode === 'account'
        ? await providerAccountAuthService.loadEffectiveCatalog(provider.id)
        : await discoverProviderModels(provider, connection?.apiKey ?? '', connection?.baseUrl ?? '', connection?.values ?? {});
      return {
        protocol: provider.protocol,
        ...('detail' in discovery && discovery.detail ? { detail: discovery.detail } : {}),
        models: applyDiscoveryAuthority(
          provider,
          discovery.contributions ?? toDiscoveryModelContributions(discovery.models),
        ),
        ...(discovery.entitlementContributions?.length
          ? {
              entitlement: {
                protocol: provider.protocol,
                detail: 'Account catalog entitlement groups',
                models: discovery.entitlementContributions,
              },
            }
          : {}),
      };
    };
  }

  async testProviderDraft(request: LlmProviderDraftRequest): Promise<LlmProviderConnectionResult> {
    try {
      const provider = this.requireDefaultConnectionProtocol(
        this.resolveProviderAuthMode(this.getProvider(request.providerId), request.authMode),
        request.protocol,
      );
      const connection = resolveProviderConnectionDraft(
        provider,
        request,
        settingsService.getProviderConnectionValues(provider.id),
      );
      const discovery = await discoverProviderModels(
        provider,
        connection.apiKey,
        connection.baseUrl,
        connection.values,
      );
      const discoveryAccountId = resolveTestDiscoveryAccountId(provider, request);
      // Reuse the discovery payload already fetched — do not hit the catalog HTTP again.
      await refreshEffectiveCatalogDiscovery(
        provider,
        discovery.models,
        discovery.contributions,
        discovery.entitlementContributions,
        undefined,
        discoveryAccountId,
      );
      return {
        success: true,
        provider,
        discoveryAccountId,
        ...discovery,
      };
    } catch (error) {
      return {
        success: false,
        models: [],
        error: parseProviderError(error),
      };
    }
  }

  async connectProvider(request: LlmProviderDraftRequest): Promise<LlmProviderConnectionResult> {
    try {
      const provider = this.requireDefaultConnectionProtocol(
        this.resolveProviderAuthMode(this.getProvider(request.providerId), request.authMode),
        request.protocol,
      );
      const connection = resolveProviderConnectionDraft(
        provider,
        request,
        settingsService.getProviderConnectionValues(provider.id),
      );
      const { apiKey, baseUrl } = connection;
      const discovery = await discoverProviderModels(provider, apiKey, baseUrl, connection.values);
      const { models } = discovery;
      const nextSettings = settingsService.saveProviderConnection(
        provider.id,
        apiKey,
        models,
        baseUrl,
        provider.protocol,
        provider.authMode,
        request.modelPreferences,
        request.connectionValues,
      );
      const nextProvider = nextSettings.llm.providers.find((entry) => entry.id === provider.id);
      if (nextProvider) {
        await refreshEffectiveCatalogDiscovery(
          nextProvider,
          models,
          discovery.contributions,
          discovery.entitlementContributions,
        );
      }
      return {
        success: true,
        provider: nextProvider,
        ...discovery,
      };
    } catch (error) {
      return {
        success: false,
        models: [],
        error: parseProviderError(error),
      };
    }
  }

  async refreshProviderModels(providerId: LlmProviderId): Promise<LlmProviderConnectionResult> {
    try {
      const provider = this.getProvider(providerId);
      if (provider.authMode === 'account') {
        const status = await providerAccountAuthService.test(provider.id);
        if (!status.connected) {
          throw new ProviderConnectionError(status.error || status.message || 'Account provider is not connected');
        }
        const nextProvider = settingsService.getAll().llm.providers.find((entry) => entry.id === provider.id);
        const discoveryAccountId = nextProvider?.activeAccountId?.trim()
          || `anonymous:${provider.id}`;
        return {
          success: true,
          provider: nextProvider,
          discoveryAccountId,
          models: nextProvider?.models ?? [],
        };
      }
      const connection = resolveProviderConnectionDraft(
        provider,
        {},
        settingsService.getProviderConnectionValues(provider.id),
      );
      const discovery = await discoverProviderModels(provider, connection.apiKey, connection.baseUrl, connection.values);
      const { models } = discovery;
      const nextSettings = settingsService.saveProviderConnection(
        provider.id,
        '',
        models,
        connection.baseUrl,
        provider.protocol,
        provider.authMode,
      );
      const nextProvider = nextSettings.llm.providers.find((entry) => entry.id === provider.id);
      const discoveryAccountId = nextProvider
        ? resolveTestDiscoveryAccountId(nextProvider, {})
        : `anonymous:${provider.id}`;
      if (nextProvider) {
        await refreshEffectiveCatalogDiscovery(
          nextProvider,
          models,
          discovery.contributions,
          discovery.entitlementContributions,
          undefined,
          discoveryAccountId,
        );
      }
      return {
        success: true,
        provider: nextProvider,
        discoveryAccountId,
        ...discovery,
      };
    } catch (error) {
      return {
        success: false,
        models: [],
        error: parseProviderError(error),
      };
    }
  }

  disconnectProvider(providerId: LlmProviderId): LlmProviderConnectionResult {
    try {
      const nextSettings = settingsService.disconnectProvider(providerId);
      const provider = nextSettings.llm.providers.find((entry) => entry.id === providerId);
      return {
        success: true,
        provider,
        models: provider?.models ?? [],
      };
    } catch (error) {
      return {
        success: false,
        models: [],
        error: parseProviderError(error),
      };
    }
  }

  startProviderAccountLogin(request: LlmProviderAccountLoginStartRequest): Promise<LlmProviderAccountStatus> {
    const provider = this.resolveProviderAuthMode(this.getProvider(request.providerId), request.authMode ?? 'account');
    const availability = provider.authModeAvailability?.account;
    if (provider.authMode !== 'account' || !provider.authModeOptions?.includes('account')) {
      return Promise.resolve({
        providerId: request.providerId,
        state: 'unavailable',
        available: false,
        connected: false,
        error: 'Provider does not support account login.',
      });
    }
    if (availability?.state === 'unavailable' || !provider.accountLoginConfigured) {
      return Promise.resolve({
        providerId: request.providerId,
        state: 'unavailable',
        available: false,
        connected: false,
        error: availability?.reason ?? 'Provider account login is not configured.',
      });
    }
    return providerAccountAuthService.startLogin({ ...request, authMode: 'account' });
  }

  finishProviderAccountLogin(request: LlmProviderAccountLoginFinishRequest): Promise<LlmProviderAccountStatus> {
    return providerAccountAuthService.finishLogin(request);
  }

  getProviderAccountStatus(providerId: LlmProviderId): LlmProviderAccountStatus {
    return providerAccountAuthService.status(providerId);
  }

  logoutProviderAccount(providerId: LlmProviderId): LlmProviderAccountStatus {
    return providerAccountAuthService.logout(providerId);
  }

  private getProvider(providerId: LlmProviderId): LlmProviderEntry {
    const provider = settingsService.getAll().llm.providers.find((entry) => entry.id === providerId);
    if (!provider || !isBuiltinProviderId(provider.id)) {
      throw new ProviderConnectionError('未知 Provider');
    }
    return provider;
  }

  private requireDefaultConnectionProtocol(provider: LlmProviderEntry, protocolDraft: unknown): LlmProviderEntry {
    if (protocolDraft !== undefined && protocolDraft !== provider.protocol) {
      throw new ProviderConnectionError(
        `Provider-level protocol switching is unsupported for ${provider.id}; choose a route on each model.`,
      );
    }
    return provider;
  }

  private resolveProviderAuthMode(
    provider: LlmProviderEntry,
    authModeDraft: LlmProviderAuthMode | undefined,
  ): LlmProviderEntry {
    const authMode = authModeDraft ?? provider.authMode;
    const options = provider.authModeOptions ?? [provider.authMode];
    if (!options.includes(authMode)) {
      throw new ProviderConnectionError(`Provider ${provider.id} does not support ${authMode} authentication.`);
    }
    const availability = getProviderAuthModeAvailability(provider.id)[authMode]
      ?? provider.authModeAvailability?.[authMode]
      ?? provider.providerAvailability;
    return {
      ...provider,
      authMode,
      activeAccountId: provider.authAccountIds?.[authMode],
      hasStoredSecret: provider.hasStoredSecretByAuthMode?.[authMode] === true,
      unavailableReason: availability.state === 'unavailable' ? availability.reason : undefined,
    };
  }
}

export const providerConnectionService = new ProviderConnectionService();
