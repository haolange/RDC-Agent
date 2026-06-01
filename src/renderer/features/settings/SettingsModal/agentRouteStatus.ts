import type { TranslationKey } from '../../../i18n';
import type { LlmAgentRoute, LlmProviderEntry } from '@shared/types/settings';
import { getEnabledModels } from './utils';

export const resolveAgentRouteStatus = (
  route: LlmAgentRoute | undefined,
  providerDrafts: LlmProviderEntry[],
): {
  issue: TranslationKey | null;
  provider: LlmProviderEntry | null;
  availableModels: LlmProviderEntry['models'];
} => {
  if (!route?.providerId) {
    return { issue: 'settings.routeReasonNoProvider', provider: null, availableModels: [] };
  }

  const provider = providerDrafts.find((entry) => entry.id === route.providerId) ?? null;
  if (!provider || !provider.enabled || !provider.isConfigured) {
    return { issue: 'settings.routeReasonProviderUnavailable', provider, availableModels: [] };
  }

  const availableModels = getEnabledModels(provider);
  if (availableModels.length === 0) {
    return { issue: 'settings.routeReasonNoModels', provider, availableModels };
  }

  if (!route.modelId || !availableModels.some((model) => model.id === route.modelId)) {
    return { issue: 'settings.routeReasonModelInvalid', provider, availableModels };
  }

  return { issue: null, provider, availableModels };
};
