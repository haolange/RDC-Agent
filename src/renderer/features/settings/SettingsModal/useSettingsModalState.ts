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
  const [activeModeProfileDraft, setActiveModeProfileDraft] = useState(settings.configuration.activeModeProfileId);
  const [enabledSkillDrafts, setEnabledSkillDrafts] = useState<string[]>(settings.configuration.enabledSkillIds);
  const [enabledMcpDrafts, setEnabledMcpDrafts] = useState<string[]>(settings.configuration.enabledMcpServerIds);
  const [patternBindingDrafts, setPatternBindingDrafts] = useState<Record<string, string>>(settings.configuration.modePatternBindings);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(settings.llm.providers[0]?.id ?? null);
  const [connectionDraft, setConnectionDraft] = useState<ProviderConnectionDraft | null>(null);
  const [agentRouteSaveState, setAgentRouteSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [agentRouteSaveMessage, setAgentRouteSaveMessage] = useState('');
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
    setActiveModeProfileDraft(settings.configuration.activeModeProfileId);
    setEnabledSkillDrafts(settings.configuration.enabledSkillIds);
    setEnabledMcpDrafts(settings.configuration.enabledMcpServerIds);
    setPatternBindingDrafts(settings.configuration.modePatternBindings);
    setSelectedProviderId(providers[0]?.id ?? null);
    setConnectionDraft(null);
    setAgentRouteSaveState('idle');
    setAgentRouteSaveMessage('');
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
    activeModeProfileDraft,
    setActiveModeProfileDraft,
    enabledSkillDrafts,
    setEnabledSkillDrafts,
    enabledMcpDrafts,
    setEnabledMcpDrafts,
    patternBindingDrafts,
    setPatternBindingDrafts,
    selectedProviderId,
    setSelectedProviderId,
    connectionDraft,
    setConnectionDraft,
    agentRouteSaveState,
    setAgentRouteSaveState,
    agentRouteSaveMessage,
    setAgentRouteSaveMessage,
  };
};
