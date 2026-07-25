import type { TranslationKey } from '../../../i18n';
import { LLM_PROVIDER_PROTOCOL_DEFINITIONS } from '@shared/constants/llm';
import type {
  LlmAgentRoute,
  LlmProviderCategory,
  LlmProviderEntry,
  LlmProviderModel,
} from '@shared/types/settings';
import type { ProviderProtocol } from './types';

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
  secretRefs: provider.secretRefs ? { ...provider.secretRefs } : undefined,
  connectionValues: provider.connectionValues ? { ...provider.connectionValues } : undefined,
  providerAvailability: { ...provider.providerAvailability },
  catalogProvenance: provider.catalogProvenance.map((entry) => ({ ...entry })),
  connectionSchema: provider.connectionSchema
    ? {
        ...provider.connectionSchema,
        fields: provider.connectionSchema.fields.map((field) => ({ ...field })),
        credentialAlternatives: provider.connectionSchema.credentialAlternatives
          ?.map((alternative) => ({ ...alternative, fieldIds: [...alternative.fieldIds] })),
        headerMappings: provider.connectionSchema.headerMappings?.map((mapping) => ({ ...mapping })),
      }
    : undefined,
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

const PROVIDER_CATEGORY_TRANSLATIONS = {
  'login-authorization': {
    label: 'settings.providerCategory.loginAuthorization.label',
    description: 'settings.providerCategory.loginAuthorization.description',
  },
  'official-direct': {
    label: 'settings.providerCategory.officialDirect.label',
    description: 'settings.providerCategory.officialDirect.description',
  },
  'cloud-platform': {
    label: 'settings.providerCategory.cloudPlatform.label',
    description: 'settings.providerCategory.cloudPlatform.description',
  },
  'coding-token-plan': {
    label: 'settings.providerCategory.codingTokenPlan.label',
    description: 'settings.providerCategory.codingTokenPlan.description',
  },
  'compatible-access': {
    label: 'settings.providerCategory.compatibleAccess.label',
    description: 'settings.providerCategory.compatibleAccess.description',
  },
  local: {
    label: 'settings.providerCategory.local.label',
    description: 'settings.providerCategory.local.description',
  },
} as const satisfies Record<LlmProviderCategory, { label: TranslationKey; description: TranslationKey }>;

export const getProviderCategoryTranslation = (category: LlmProviderCategory) => (
  PROVIDER_CATEGORY_TRANSLATIONS[category]
);

export const getProviderProtocolLabel = (protocol: ProviderProtocol): string => {
  const definition = LLM_PROVIDER_PROTOCOL_DEFINITIONS.find((entry) => entry.id === protocol);
  return definition?.label ?? protocol;
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
