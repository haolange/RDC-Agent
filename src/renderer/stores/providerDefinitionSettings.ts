import { ProviderDefinitionMutationCoordinator } from './ProviderDefinitionMutationCoordinator';
import type {
  AppSettings,
  LlmProviderEntry,
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

export const enqueueProviderDefinitionSave = (
  provider: LlmProviderEntry,
  clientRevision: number,
): Promise<ProviderDefinitionSaveResult> => mutations.enqueue({ provider, clientRevision });

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
