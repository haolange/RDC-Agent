import { useEffect, useRef, useState } from 'react';
import type { AppSettings, LlmAgentRoute, LlmProviderEntry } from '@shared/types/settings';
import type { ProviderConnectionDraft, SettingsSection } from './types';
import { cloneProvider, cloneRoute } from './utils';

export const useSettingsModalState = (open: boolean, settings: AppSettings) => {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const [accountDraft, setAccountDraft] = useState(settings.profile);
  const [workspaceDraft, setWorkspaceDraft] = useState(settings.workspace.rootPath);
  const [providerDrafts, setProviderDrafts] = useState<LlmProviderEntry[]>(settings.llm.providers.map(cloneProvider));
  const [agentRouteDrafts, setAgentRouteDrafts] = useState<LlmAgentRoute[]>(settings.llm.agentRoutes.map(cloneRoute));
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(settings.llm.providers[0]?.id ?? null);
  const [connectionDraft, setConnectionDraft] = useState<ProviderConnectionDraft | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;

    wasOpenRef.current = true;
    setActiveSection('general');
    setAccountDraft(settings.profile);
    setWorkspaceDraft(settings.workspace.rootPath);
    const providers = settings.llm.providers.map(cloneProvider);
    setProviderDrafts(providers);
    setAgentRouteDrafts(settings.llm.agentRoutes.map(cloneRoute));
    setSelectedProviderId(providers[0]?.id ?? null);
    setConnectionDraft(null);
  }, [open, settings]);

  return {
    activeSection,
    setActiveSection,
    accountDraft,
    setAccountDraft,
    workspaceDraft,
    setWorkspaceDraft,
    providerDrafts,
    setProviderDrafts,
    agentRouteDrafts,
    setAgentRouteDrafts,
    selectedProviderId,
    setSelectedProviderId,
    connectionDraft,
    setConnectionDraft,
  };
};
