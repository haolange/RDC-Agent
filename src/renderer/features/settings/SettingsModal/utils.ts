import { LLM_PROVIDER_PROTOCOL_DEFINITIONS } from '@shared/constants/llm';
import type { TranslationKey } from '../../../i18n';
import type {
  LlmProviderCategory,
  LlmProviderEntry,
} from '@shared/types/settings';
import type { ProviderProtocol } from './types';

export const STORED_SECRET_MASK = '************************';

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

export const getEnabledModels = (provider?: Pick<LlmProviderEntry, 'models'> | null) =>
  provider?.models.filter((model) => model.enabled) ?? [];

export const getProviderDisplayLabel = (
  provider: Pick<LlmProviderEntry, 'label'>,
  fallbackLabel: string,
): string => provider.label.trim() || fallbackLabel;

const PROVIDER_CATEGORY_TRANSLATIONS = {
  'login-authorization': 'settings.providerCategory.loginAuthorization.label',
  'official-direct': 'settings.providerCategory.officialDirect.label',
  'cloud-platform': 'settings.providerCategory.cloudPlatform.label',
  'coding-token-plan': 'settings.providerCategory.codingTokenPlan.label',
  'compatible-access': 'settings.providerCategory.compatibleAccess.label',
  local: 'settings.providerCategory.local.label',
} as const satisfies Record<LlmProviderCategory, TranslationKey>;

export const getProviderCategoryTranslation = (category: LlmProviderCategory) => PROVIDER_CATEGORY_TRANSLATIONS[category];

export const getProviderProtocolLabel = (protocol: ProviderProtocol): string => {
  const definition = LLM_PROVIDER_PROTOCOL_DEFINITIONS.find((entry) => entry.id === protocol);
  return definition?.label ?? protocol;
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
