import { useEffect, useRef, useState } from 'react';
import type { AgentManifestDraft } from '@shared/types/agentManifest';
import type {
  AppSettings,
  LlmAgentRoute,
  LlmProviderEntry,
  RdxActionSettingsMap,
  RdxCliInvokerSettings,
} from '@shared/types/settings';
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
  const [rdxCliDraft, setRdxCliDraft] = useState<RdxCliInvokerSettings>(settings.tooling.rdxCli);
  const [rdxActionsDraft, setRdxActionsDraft] = useState<RdxActionSettingsMap>(cloneRdxActions(settings.tooling.rdxActions));
  const [agentManifestDrafts, setAgentManifestDrafts] = useState<AgentManifestDraft[]>(
    settings.agents.definitions.map((definition) => ({ ...definition })),
  );
  const [globalInstructionsDraft, setGlobalInstructionsDraft] = useState(settings.agents.globalInstructions);
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
    setRdxCliDraft(settings.tooling.rdxCli);
    setRdxActionsDraft(cloneRdxActions(settings.tooling.rdxActions));
    setAgentManifestDrafts(settings.agents.definitions.map((definition) => ({ ...definition })));
    setGlobalInstructionsDraft(settings.agents.globalInstructions);
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
    rdxCliDraft,
    setRdxCliDraft,
    rdxActionsDraft,
    setRdxActionsDraft,
    agentManifestDrafts,
    setAgentManifestDrafts,
    globalInstructionsDraft,
    setGlobalInstructionsDraft,
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

const defaultRdxAction = () => ({
  enabled: false,
  command: '',
  args: [],
  workingDirectory: '',
  env: {},
  timeoutMs: 60000,
});

function cloneRdxActions(actions?: Partial<RdxActionSettingsMap>): RdxActionSettingsMap {
  return {
    openCapture: cloneRdxAction(actions?.openCapture ?? defaultRdxAction()),
    connectRemote: cloneRdxAction(actions?.connectRemote ?? defaultRdxAction()),
    closeRuntime: cloneRdxAction(actions?.closeRuntime ?? defaultRdxAction()),
    openPreview: cloneRdxAction(actions?.openPreview ?? defaultRdxAction()),
  };
}

function cloneRdxAction(action: RdxActionSettingsMap[keyof RdxActionSettingsMap]): RdxActionSettingsMap[keyof RdxActionSettingsMap] {
  return {
    ...action,
    args: [...action.args],
    env: { ...action.env },
  };
}
