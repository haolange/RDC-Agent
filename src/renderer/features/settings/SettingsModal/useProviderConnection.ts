import type { AppSettings, AppSettingsPatch, LlmAgentRoute, LlmProviderEntry } from '@shared/types/settings';
import type { Dispatch, SetStateAction } from 'react';
import type { useI18n } from '../../../i18n';
import type { ProviderConnectionDraft } from './types';
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
  patchSettings: (patch: AppSettingsPatch) => Promise<AppSettings>;
  t: Translate;
}

export const useProviderConnection = (options: UseProviderConnectionOptions) => {
  const draft = useProviderConnectionDraft(options);
  const actions = useProviderConnectionActions(
    options.connectionDraft,
    options.setConnectionDraft,
    options.providerDrafts,
    options.patchSettings,
    draft,
    options.t,
  );

  return {
    ...draft,
    ...actions,
  };
};
