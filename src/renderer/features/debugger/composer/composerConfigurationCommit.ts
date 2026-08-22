import type { ConversationSendRequest } from '@shared/types/conversation';
import { useAppSettingsStore } from '../../../stores/appSettingsStore';

export interface ConversationModelOverride {
  providerId: string;
  modelId: string;
}

export async function buildConversationConfigurationCommit(input: {
  selectedAgentId: string;
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
  const agentCommit = await useAppSettingsStore.getState().flushAgentDefinitionSaves(input.selectedAgentId);
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
