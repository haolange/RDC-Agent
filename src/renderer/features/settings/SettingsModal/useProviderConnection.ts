import { useRef, type Dispatch, type SetStateAction } from 'react';
import { updateProviderModelPreference } from './providerModelProjection';
import { hasProviderConnectionDefinitionChanged } from './providerConnectionRequest';
import { useProviderConnectionActions } from './useProviderConnectionActions';
import { useProviderConnectionDraft } from './useProviderConnectionDraft';
import type { ProviderConnectionDraft } from './types';
import type { useI18n } from '../../../i18n';
import type {
  AppSettings,
  LlmProviderEntry,
  LlmProviderModel,
  ProviderDefinitionSaveResult,
} from '@shared/types/settings';

type Translate = ReturnType<typeof useI18n>['t'];

interface UseProviderConnectionOptions {
  open: boolean;
  settings: AppSettings;
  providerDrafts: LlmProviderEntry[];
  setProviderDrafts: Dispatch<SetStateAction<LlmProviderEntry[]>>;
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
  connectionDraftRef.current = options.connectionDraft;

  const actions = useProviderConnectionActions(
    options.connectionDraft,
    options.setConnectionDraft,
    options.providerDrafts,
    options.saveProvider,
    draft,
    options.t,
  );

  const updateConnectionModelPreference = (modelId: string, patch: Partial<LlmProviderModel>) => {
    const currentDraft = connectionDraftRef.current;
    const provider = options.providerDrafts.find((entry) => entry.id === currentDraft?.providerId);
    if (!currentDraft || !provider) return;
    const models = updateProviderModelPreference(provider.catalogOwnership, currentDraft.models, modelId, patch);
    const nextDraft = { ...currentDraft, models, modelSaveError: undefined };
    connectionDraftRef.current = nextDraft;
    options.setConnectionDraft(nextDraft);
    const connectionOwner = { ...provider, configuredAuthMode: provider.configuredAuthMode ?? provider.authMode };
    if (hasProviderConnectionDefinitionChanged(connectionOwner, currentDraft)) return;

    void options.saveProvider({ ...provider, models }).then((result) => {
      if (result.status === 'superseded') return;
      const confirmed = result.lastSuccessful?.provider;
      if (confirmed)
        options.setProviderDrafts((providers) =>
          providers.map((entry) => (entry.id === provider.id ? confirmed : entry)),
        );
      options.setConnectionDraft((current) => {
        if (current?.providerId !== provider.id || hasProviderConnectionDefinitionChanged(connectionOwner, current))
          return current;
        // The dialog can be reopened before the write returns. Only reconcile
        // a fresh draft still showing the original saved model selection.
        const submittedHere = current.models === models;
        if (!submittedHere && JSON.stringify(current.models) !== JSON.stringify(provider.models)) return current;
        if (result.status === 'committed')
          return submittedHere || !confirmed ? current : { ...current, models: confirmed.models };
        return {
          ...current,
          models: (confirmed ?? provider).models,
          modelSaveError: result.error ?? options.t('settings.providerSaveFailed'),
        };
      });
    });
  };

  return {
    ...draft,
    ...actions,
    updateConnectionModelPreference,
  };
};
