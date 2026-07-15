import type {
  AppSettings,
  LlmAgentRoute,
  LlmProviderEntry,
  LlmProviderModel,
  ProviderDefinitionSaveResult,
} from '@shared/types/settings';
import { useRef, type Dispatch, type SetStateAction } from 'react';
import type { useI18n } from '../../../i18n';
import type { ProviderConnectionDraft } from './types';
import { updateProviderModelPreference } from './providerModelProjection';
import { useProviderConnectionActions } from './useProviderConnectionActions';
import { useProviderConnectionDraft } from './useProviderConnectionDraft';

type Translate = ReturnType<typeof useI18n>['t'];

interface UseProviderConnectionOptions {
  open: boolean;
  settings: AppSettings;
  providerDrafts: LlmProviderEntry[];
  setProviderDrafts: Dispatch<SetStateAction<LlmProviderEntry[]>>;
  setAgentRouteDrafts: Dispatch<SetStateAction<LlmAgentRoute[]>>;
  selectedProviderId: string | null;
  setSelectedProviderId: Dispatch<SetStateAction<string | null>>;
  connectionDraft: ProviderConnectionDraft | null;
  setConnectionDraft: Dispatch<SetStateAction<ProviderConnectionDraft | null>>;
  reloadSettings: () => Promise<AppSettings>;
  saveProvider: (provider: LlmProviderEntry) => Promise<ProviderDefinitionSaveResult>;
  t: Translate;
}

export const useProviderConnection = (options: UseProviderConnectionOptions) => {
  const draft = useProviderConnectionDraft(options);
  const connectionDraftRef = useRef(options.connectionDraft);
  const providerDraftsRef = useRef(options.providerDrafts);
  connectionDraftRef.current = options.connectionDraft;
  providerDraftsRef.current = options.providerDrafts;

  const actions = useProviderConnectionActions(
    options.connectionDraft,
    options.setConnectionDraft,
    options.providerDrafts,
    options.saveProvider,
    draft,
    options.t,
  );

  const rollbackFailedPreference = async (providerId: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    try {
      const settings = await draft.refreshLocalSettings(providerId);
      const provider = settings.llm.providers.find((entry) => entry.id === providerId);
      if (!provider) throw new Error(`Provider ${providerId} disappeared during rollback.`);
      providerDraftsRef.current = settings.llm.providers;
      options.setConnectionDraft((current) => {
        if (!current || current.providerId !== providerId) return current;
        const next = {
          ...current,
          protocol: provider.protocol,
          baseUrl: provider.baseUrl ?? '',
          models: provider.models.map((model) => ({ ...model })),
          error: message,
        };
        connectionDraftRef.current = next;
        return next;
      });
    } catch {
      options.setConnectionDraft((current) => current?.providerId === providerId
        ? { ...current, error: message }
        : current);
    }
  };

  const persistPreference = (provider: LlmProviderEntry) => {
    void options.saveProvider(provider).catch((error) => rollbackFailedPreference(provider.id, error));
  };

  const updateConnectionModelPreference = (modelId: string, patch: Partial<LlmProviderModel>) => {
    const currentDraft = connectionDraftRef.current;
    const provider = providerDraftsRef.current.find((entry) => entry.id === currentDraft?.providerId);
    if (!currentDraft || !provider) return;
    const models = updateProviderModelPreference(
      provider.catalogOwnership,
      currentDraft.models,
      modelId,
      patch,
    );
    const nextDraft = { ...currentDraft, models, error: '' };
    const nextProvider = { ...provider, models: models.map((model) => ({ ...model })) };
    connectionDraftRef.current = nextDraft;
    providerDraftsRef.current = providerDraftsRef.current.map((entry) => (
      entry.id === provider.id ? nextProvider : entry
    ));
    options.setConnectionDraft(nextDraft);
    options.setProviderDrafts(providerDraftsRef.current);
    persistPreference(nextProvider);
  };

  return {
    ...draft,
    ...actions,
    updateConnectionModelPreference,
  };
};
