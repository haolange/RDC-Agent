import type { ConversationSendRequest } from '@shared/types/conversation';
import { resolveAgentWriteTarget } from '@shared/types/agentManifest';
import { useAppSettingsStore } from './appSettingsStore';

export interface ConversationModelOverride {
  providerId: string;
  modelId: string;
}

export async function buildConversationConfigurationCommit(input: {
  selectedAgentId: string;
  currentProjectId?: string | null;
  getEffectiveCatalog: (providerId: string) => Promise<{
    catalogRevision?: string;
    models: Array<{ modelId: string; routeRevision?: string }>;
  } | null>;
  modelOverride?: ConversationModelOverride | null;
}): Promise<{
  agentId: string;
  providerId?: string;
  modelId?: string;
  configurationCommit: NonNullable<ConversationSendRequest['configurationCommit']>;
}> {
  const definition = useAppSettingsStore.getState().settings.agents.definitions.find(
    (entry) => entry.id === input.selectedAgentId,
  );
  const writeTarget = resolveAgentWriteTarget(definition, input.currentProjectId);
  const agentCommit = await useAppSettingsStore.getState().flushAgentDefinitionSaves({
    agentId: input.selectedAgentId,
    ...writeTarget,
  });
  const providerId = input.modelOverride?.providerId || agentCommit?.route?.providerId;
  const modelId = input.modelOverride?.modelId || agentCommit?.route?.modelId;
  const providerCommit = providerId
    ? await useAppSettingsStore.getState().flushProviderSaves(providerId)
    : null;
  const effectiveCatalog = providerId
    ? await input.getEffectiveCatalog(providerId)
    : null;
  const selectedModel = effectiveCatalog?.models.find((model) => model.modelId === modelId);
  return {
    agentId: input.selectedAgentId,
    providerId,
    modelId,
    configurationCommit: {
      agentId: input.selectedAgentId,
      agentCommitHash: agentCommit?.commitHash,
      providerId,
      modelId,
      providerCommitHash: providerCommit?.commitHash,
      providerCatalogRevision: effectiveCatalog?.catalogRevision ?? providerCommit?.catalogRevision ?? undefined,
      routeRevision: selectedModel?.routeRevision,
    },
  };
}
