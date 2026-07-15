import type {
  AppSettings,
  LlmProviderEntry,
  ProviderDefinitionCommitSnapshot,
  ProviderDefinitionSaveResult,
} from '@shared/types/settings';
import { ProviderDefinitionMutationCoordinator } from './ProviderDefinitionMutationCoordinator';

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

const project = (
  settings: AppSettings,
  providerId: string,
  provider: LlmProviderEntry | null,
): AppSettings => ({
  ...settings,
  llm: {
    ...settings.llm,
    providers: provider
      ? upsert(settings.llm.providers, provider)
      : settings.llm.providers.filter((entry) => entry.id !== providerId),
  },
});

export function beginProviderDefinitionSave(settings: AppSettings, provider: LlmProviderEntry): {
  clientRevision: number;
  previous: LlmProviderEntry | null;
  settings: AppSettings;
} {
  lastRevision = Math.max(Date.now() * 1_000, lastRevision + 1);
  revisions.set(provider.id, lastRevision);
  return {
    clientRevision: lastRevision,
    previous: settings.llm.providers.find((entry) => entry.id === provider.id) ?? null,
    settings: project(settings, provider.id, provider),
  };
}

export const isLatestProviderDefinitionRevision = (providerId: string, revision: number): boolean => (
  revisions.get(providerId) === revision
);

export const enqueueProviderDefinitionSave = (
  provider: LlmProviderEntry,
  clientRevision: number,
): Promise<ProviderDefinitionSaveResult> => mutations.enqueue({ provider, clientRevision });

export const settleProviderDefinitionSave = (
  settings: AppSettings,
  provider: LlmProviderEntry,
): AppSettings => project(settings, provider.id, provider);

export const rollbackProviderDefinitionSave = (
  settings: AppSettings,
  providerId: string,
  snapshot: ProviderDefinitionCommitSnapshot | null,
  previous: LlmProviderEntry | null,
): AppSettings => project(settings, providerId, snapshot?.provider ?? previous);

export async function flushProviderDefinitionSaves(
  providerId: string,
): Promise<ProviderDefinitionCommitSnapshot | null> {
  await mutations.flush(providerId);
  return window.electronAPI.settings.getProviderDefinitionCommit(providerId);
}
