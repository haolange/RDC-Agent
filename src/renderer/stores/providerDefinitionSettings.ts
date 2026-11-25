import { providerConnectionIdentity } from '@shared/utils/providerConnectionIdentity';
import { errorDetail } from '../lib/errorDetail';
import type {
  LlmProviderEntry,
  LlmProviderModel,
  ProviderModelChoice,
  ProviderDefinitionSaveRequest,
  ProviderDefinitionSaveResult,
} from '@shared/types/settings';
import type { SettingsOverlay } from './settingsIntents';

/** The user's part of each model row; label and aliases only matter for a row the catalog does not list. */
const modelChoices = (models: readonly LlmProviderModel[]): ProviderModelChoice[] => models.map((model) => ({
  id: model.id,
  enabled: model.enabled,
  ...(model.defaultReasoningSelection ? { defaultReasoningSelection: model.defaultReasoningSelection } : {}),
  ...(model.defaultBudgetTokens ? { defaultBudgetTokens: model.defaultBudgetTokens } : {}),
  ...(model.preferredRouteOptionId ? { preferredRouteOptionId: model.preferredRouteOptionId } : {}),
  ...(model.label && model.label !== model.id ? { label: model.label } : {}),
  ...(model.aliases?.length ? { aliases: model.aliases } : {}),
}));

/** Sends only the model choices, with the connection they were made on; main keeps every other field. */
export const providerDefinitionRequest = (provider: LlmProviderEntry, clientRevision: number): ProviderDefinitionSaveRequest => ({
  providerId: provider.id,
  connectionIdentity: providerConnectionIdentity(provider),
  models: modelChoices(provider.models),
  clientRevision,
});

/** `provider` in place of the entry of the same connection; another connection of that provider stays. */
const onSameConnection = (provider: LlmProviderEntry, next: (current: LlmProviderEntry) => LlmProviderEntry): SettingsOverlay => (settings) => {
  const identity = providerConnectionIdentity(provider);
  const sameConnection = (entry: LlmProviderEntry) => entry.id === provider.id && providerConnectionIdentity(entry) === identity;
  if (!settings.llm.providers.some(sameConnection)) return settings;
  const providers = settings.llm.providers.map((entry) => (sameConnection(entry) ? next(entry) : entry));
  return { ...settings, llm: { ...settings.llm, providers } };
};

/** The model choices shown while their save is in flight. */
export const providerChoicesOverlay = (provider: LlmProviderEntry): SettingsOverlay => (
  onSameConnection(provider, (entry) => ({ ...entry, models: provider.models }))
);

/** The provider as main committed it. */
export const providerCommit = (provider: LlmProviderEntry): SettingsOverlay => onSameConnection(provider, () => provider);

/** A request that never reached main reads as a failed save with no commit to fall back to. */
export const failedProviderSave = (request: ProviderDefinitionSaveRequest, error: unknown): ProviderDefinitionSaveResult => ({
  clientRevision: request.clientRevision,
  providerId: request.providerId,
  status: 'failed',
  commitHash: null,
  provider: null,
  catalogRevision: null,
  lastSuccessful: null,
  error: errorDetail(error),
});

/** What `flushProviderSaves` waits on: a save main refused counts as failed, like one that never arrived. */
export const providerSaveOutcome = (save: Promise<ProviderDefinitionSaveResult>): Promise<ProviderDefinitionSaveResult> => (
  save.then((result) => (result.status === 'failed'
    ? Promise.reject(new Error(result.error ?? 'Provider settings save failed.'))
    : result))
);
