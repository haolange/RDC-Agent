import { providerConnectionIdentity } from '@shared/utils/providerConnectionIdentity';
import { ProviderDefinitionMutationCoordinator } from './ProviderDefinitionMutationCoordinator';
import type {
  AppSettings,
  LlmProviderEntry,
  LlmProviderModel,
  ProviderModelChoice,
  ProviderDefinitionCommitSnapshot,
  ProviderDefinitionSaveResult,
} from '@shared/types/settings';

const mutations = new ProviderDefinitionMutationCoordinator(
  (request) => window.electronAPI.settings.saveProviderDefinition(request),
);
const revisions = new Map<string, number>();
let lastRevision = 0;

const upsert = (providers: LlmProviderEntry[], provider: LlmProviderEntry): LlmProviderEntry[] => (
  providers.some((entry) => entry.id === provider.id)
    ? providers.map((entry) => entry.id === provider.id ? provider : entry)
    : [...providers, provider]
);

export function beginProviderDefinitionSave(providerId: string): number {
  lastRevision = Math.max(Date.now() * 1_000, lastRevision + 1);
  revisions.set(providerId, lastRevision);
  return lastRevision;
}

export const isLatestProviderDefinitionRevision = (providerId: string, revision: number): boolean => (
  revisions.get(providerId) === revision
);

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
export const enqueueProviderDefinitionSave = (
  provider: LlmProviderEntry,
  clientRevision: number,
): Promise<ProviderDefinitionSaveResult> => mutations.enqueue({
  providerId: provider.id,
  connectionIdentity: providerConnectionIdentity(provider),
  models: modelChoices(provider.models),
  clientRevision,
});

export const settleProviderDefinitionSave = (
  settings: AppSettings,
  provider: LlmProviderEntry,
): AppSettings => ({
  ...settings,
  llm: { ...settings.llm, providers: upsert(settings.llm.providers, provider) },
});

export async function flushProviderDefinitionSaves(
  providerId: string,
): Promise<ProviderDefinitionCommitSnapshot | null> {
  await mutations.flush(providerId);
  return window.electronAPI.settings.getProviderDefinitionCommit(providerId);
}
