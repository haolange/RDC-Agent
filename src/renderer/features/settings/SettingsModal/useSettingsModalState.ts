import { useEffect, useRef, useState } from 'react';
import type { AgentManifestDraft } from '@shared/types/agentManifest';
import { toAgentManifestEditorDraft } from '@shared/types/agentManifest';
import type {
  AppSettings,
  LlmAgentRoute,
  LlmProviderEntry,
  RdcCliInvokerSettings,
  AgentShellSettings,
  CodeInterpreterSettings,
} from '@shared/types/settings';
import type { ProviderConnectionDraft, SettingsSection } from './types';
import { cloneProvider, cloneRoute } from './utils';

export const useSettingsModalState = (
  open: boolean,
  settings: AppSettings,
  currentProjectId?: string | null,
) => {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const [accountDraft, setAccountDraft] = useState(settings.profile);
  const [providerDrafts, setProviderDrafts] = useState<LlmProviderEntry[]>(settings.llm.providers.map(cloneProvider));
  const [agentRouteDrafts, setAgentRouteDrafts] = useState<LlmAgentRoute[]>(settings.llm.agentRoutes.map(cloneRoute));
  const [rdcCliDraft, setRdcCliDraft] = useState<RdcCliInvokerSettings>(settings.tooling.rdcCli);
  const [codeInterpreterDraft, setCodeInterpreterDraft] = useState<CodeInterpreterSettings>(
    settings.tooling.codeInterpreter,
  );
  const [shellDraft, setShellDraft] = useState<AgentShellSettings>(settings.tooling.shell);
  const [agentManifestDrafts, setAgentManifestDrafts] = useState<AgentManifestDraft[]>(
    settings.agents.definitions.map((definition) => toAgentManifestEditorDraft(definition, currentProjectId)),
  );
  const [globalInstructionsDraft, setGlobalInstructionsDraft] = useState(settings.agents.globalInstructions);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(settings.llm.providers[0]?.id ?? null);
  const [connectionDraft, setConnectionDraft] = useState<ProviderConnectionDraft | null>(null);
  const [agentManifestSaveState, setAgentManifestSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [agentManifestSaveMessage, setAgentManifestSaveMessage] = useState('');
  const [agentManifestSaveBlocked, setAgentManifestSaveBlocked] = useState(false);
  const wasOpenRef = useRef(false);
  const lastProjectIdRef = useRef<string | null | undefined>(currentProjectId);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    const projectChanged = lastProjectIdRef.current !== currentProjectId;
    if (wasOpenRef.current && !projectChanged) return;
    lastProjectIdRef.current = currentProjectId;
    wasOpenRef.current = true;
    setActiveSection('general');
    setAccountDraft(settings.profile);
    const providers = settings.llm.providers.map(cloneProvider);
    setProviderDrafts(providers);
    setAgentRouteDrafts(settings.llm.agentRoutes.map(cloneRoute));
    setRdcCliDraft(settings.tooling.rdcCli);
    setCodeInterpreterDraft(settings.tooling.codeInterpreter);
    setShellDraft(settings.tooling.shell);
    setAgentManifestDrafts(settings.agents.definitions.map((definition) => (
      toAgentManifestEditorDraft(definition, currentProjectId)
    )));
    setGlobalInstructionsDraft(settings.agents.globalInstructions);
    setSelectedProviderId(providers[0]?.id ?? null);
    setConnectionDraft(null);
    setAgentManifestSaveState('idle');
    setAgentManifestSaveMessage('');
    setAgentManifestSaveBlocked(false);
  }, [open, settings, currentProjectId]);

  return {
    activeSection,
    setActiveSection,
    accountDraft,
    setAccountDraft,
    providerDrafts,
    setProviderDrafts,
    agentRouteDrafts,
    setAgentRouteDrafts,
    rdcCliDraft,
    setRdcCliDraft,
    codeInterpreterDraft,
    setCodeInterpreterDraft,
    shellDraft,
    setShellDraft,
    agentManifestDrafts,
    setAgentManifestDrafts,
    globalInstructionsDraft,
    setGlobalInstructionsDraft,
    selectedProviderId,
    setSelectedProviderId,
    connectionDraft,
    setConnectionDraft,
    agentManifestSaveState,
    setAgentManifestSaveState,
    agentManifestSaveMessage,
    setAgentManifestSaveMessage,
    agentManifestSaveBlocked,
    setAgentManifestSaveBlocked,
  };
};
