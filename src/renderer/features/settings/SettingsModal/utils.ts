import type { TranslationKey } from '../../../i18n';
import type { LlmAgentRoute, LlmProviderEntry, LlmProviderModel } from '@shared/types/settings';

export const STORED_SECRET_MASK = '••••••••••••••••••••••••';

export const joinPath = (root: string, ...segments: string[]): string => {
  const separator = root.includes('\\') ? '\\' : '/';
  return [root.replace(/[\\/]+$/, ''), ...segments.map((segment) => segment.replace(/^[\\/]+/, ''))]
    .filter(Boolean)
    .join(separator);
};

export const cloneProvider = (provider: LlmProviderEntry): LlmProviderEntry => ({
  ...provider,
  models: provider.models.map((model) => ({ ...model })),
  recommendedModels: [...provider.recommendedModels],
});

export const cloneRoute = (route: LlmAgentRoute): LlmAgentRoute => ({ ...route });

export const getEnabledModels = (provider?: Pick<LlmProviderEntry, 'models'> | null) =>
  provider?.models.filter((model) => model.enabled) ?? [];

export const getProviderDisplayLabel = (
  provider: Pick<LlmProviderEntry, 'label'>,
  fallbackLabel: string,
): string => provider.label.trim() || fallbackLabel;

export const getProviderGroupLabel = (provider: Pick<LlmProviderEntry, 'catalogGroup'>): string => {
  if (provider.catalogGroup === 'local') return 'Local';
  if (provider.catalogGroup === 'account') return 'Account';
  if (provider.catalogGroup === 'environment') return 'Environment';
  return 'API Key';
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
