import type { TranslationKey } from '../../../i18n';
import { LLM_PROVIDER_PROTOCOL_DEFINITIONS } from '@shared/constants/llm';
import type { LlmAgentRoute, LlmProviderEntry, LlmProviderModel } from '@shared/types/settings';
import type { ProviderCatalogCategory, ProviderProtocol } from './types';

export const STORED_SECRET_MASK = '************************';

export const joinPath = (root: string, ...segments: string[]): string => {
  const separator = root.includes('\\') ? '\\' : '/';
  return [root.replace(/[\\/]+$/, ''), ...segments.map((segment) => segment.replace(/^[\\/]+/, ''))]
    .filter(Boolean)
    .join(separator);
};

export const cloneProvider = (provider: LlmProviderEntry): LlmProviderEntry => ({
  ...provider,
  authModeOptions: provider.authModeOptions ? [...provider.authModeOptions] : undefined,
  authModeAvailability: provider.authModeAvailability
    ? Object.fromEntries(Object.entries(provider.authModeAvailability).map(([mode, availability]) => [mode, { ...availability }]))
    : undefined,
  authAccountIds: provider.authAccountIds ? { ...provider.authAccountIds } : undefined,
  hasStoredSecretByAuthMode: provider.hasStoredSecretByAuthMode ? { ...provider.hasStoredSecretByAuthMode } : undefined,
  providerAvailability: { ...provider.providerAvailability },
  protocolOptions: provider.protocolOptions ? [...provider.protocolOptions] : undefined,
  protocolBaseUrls: provider.protocolBaseUrls ? { ...provider.protocolBaseUrls } : undefined,
  models: provider.models.map((model) => ({ ...model })),
  recommendedModels: [...provider.recommendedModels],
  capabilities: provider.capabilities ? [...provider.capabilities] : undefined,
});

export const cloneRoute = (route: LlmAgentRoute): LlmAgentRoute => ({ ...route });

export const getEnabledModels = (provider?: Pick<LlmProviderEntry, 'models'> | null) =>
  provider?.models.filter((model) => model.enabled) ?? [];

export const getProviderDisplayLabel = (
  provider: Pick<LlmProviderEntry, 'label'>,
  fallbackLabel: string,
): string => provider.label.trim() || fallbackLabel;

export const getProviderCategoryLabel = (
  provider: Pick<LlmProviderEntry, 'category'>,
  categories: ProviderCatalogCategory[] = [],
): string => categories.find((category) => category.id === provider.category)?.label ?? provider.category;

export const getProviderProtocolLabel = (protocol: ProviderProtocol): string => {
  const definition = LLM_PROVIDER_PROTOCOL_DEFINITIONS.find((entry) => entry.id === protocol);
  return definition?.label ?? protocol;
};

export const providerSupportsProtocolSelection = (
  provider: Pick<LlmProviderEntry, 'protocolEditable' | 'protocolOptions'>,
): boolean => Boolean(provider.protocolEditable && provider.protocolOptions?.length);

export const getProviderProtocolOptions = (
  provider: Pick<LlmProviderEntry, 'protocol' | 'protocolEditable' | 'protocolOptions'>,
): ProviderProtocol[] => providerSupportsProtocolSelection(provider)
  ? provider.protocolOptions ?? [provider.protocol]
  : [provider.protocol];

export const providerShowsResponsesHint = (protocol: ProviderProtocol): boolean =>
  protocol === 'OpenAIResponses';

export const resolveConnectionBaseUrlForProtocol = (
  provider: Pick<LlmProviderEntry, 'protocol' | 'baseUrl' | 'protocolBaseUrls'>,
  nextProtocol: ProviderProtocol,
): string => {
  const previousDefault = provider.protocolBaseUrls?.[provider.protocol]?.replace(/\/+$/, '') ?? '';
  const nextDefault = provider.protocolBaseUrls?.[nextProtocol]?.replace(/\/+$/, '') ?? '';
  const current = (provider.baseUrl ?? '').trim().replace(/\/+$/, '');
  return !current || current === previousDefault ? nextDefault || current : provider.baseUrl?.trim() ?? current;
};

export const getProviderStatusLabel = (provider: Pick<LlmProviderEntry, 'status' | 'isConfigured'>): TranslationKey => {
  if (provider.status === 'verified' && provider.isConfigured) return 'settings.providerConnected';
  if (provider.status === 'failed') return 'settings.providerFailed';
  if (provider.status === 'unavailable') return 'settings.providerUnavailable';
  return 'settings.providerUnconfigured';
};

export const getModelSummary = (models: LlmProviderModel[], fallback: string): string => {
  if (models.length === 0) return fallback;
  if (models.length <= 2) return models.map((model) => model.label).join(', ');
  return `${models.slice(0, 2).map((model) => model.label).join(', ')} +${models.length - 2}`;
};

export const sortProvidersByLabel = (providers: LlmProviderEntry[]): LlmProviderEntry[] =>
  [...providers].sort((left, right) => (
    getProviderDisplayLabel(left, left.id).localeCompare(
      getProviderDisplayLabel(right, right.id),
      undefined,
      { sensitivity: 'base' },
    )
  ));

export const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
};
