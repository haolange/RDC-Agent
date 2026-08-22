import { useEffect, useRef, useState } from 'react';
import type { AgentManifestDraft } from '@shared/types/agentManifest';
import type {
  AppSettings,
  LlmAgentRoute,
  LlmProviderEntry,
  RdxActionSettingsMap,
  RdxCliInvokerSettings,
  CodeInterpreterSettings,
} from '@shared/types/settings';
import type { ProviderConnectionDraft, SettingsSection } from './types';
import { cloneProvider, cloneRoute } from './utils';

export const useSettingsModalState = (open: boolean, settings: AppSettings) => {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const [accountDraft, setAccountDraft] = useState(settings.profile);
  const [providerDrafts, setProviderDrafts] = useState<LlmProviderEntry[]>(settings.llm.providers.map(cloneProvider));
  const [agentRouteDrafts, setAgentRouteDrafts] = useState<LlmAgentRoute[]>(settings.llm.agentRoutes.map(cloneRoute));
  const [rdxCliDraft, setRdxCliDraft] = useState<RdxCliInvokerSettings>(settings.tooling.rdxCli);
  const [rdxActionsDraft, setRdxActionsDraft] = useState<RdxActionSettingsMap>(cloneRdxActions(settings.tooling.rdxActions));
  const [codeInterpreterDraft, setCodeInterpreterDraft] = useState<CodeInterpreterSettings>(
    settings.tooling.codeInterpreter,
  );
  const [agentManifestDrafts, setAgentManifestDrafts] = useState<AgentManifestDraft[]>(
    settings.agents.definitions.map((definition) => ({ ...definition })),
  );
  const [globalInstructionsDraft, setGlobalInstructionsDraft] = useState(settings.agents.globalInstructions);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(settings.llm.providers[0]?.id ?? null);
  const [connectionDraft, setConnectionDraft] = useState<ProviderConnectionDraft | null>(null);
  const [agentManifestSaveState, setAgentManifestSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [agentManifestSaveMessage, setAgentManifestSaveMessage] = useState('');
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
    const providers = settings.llm.providers.map(cloneProvider);
    setProviderDrafts(providers);
    setAgentRouteDrafts(settings.llm.agentRoutes.map(cloneRoute));
    setRdxCliDraft(settings.tooling.rdxCli);
    setRdxActionsDraft(cloneRdxActions(settings.tooling.rdxActions));
    setCodeInterpreterDraft(settings.tooling.codeInterpreter);
    setAgentManifestDrafts(settings.agents.definitions.map((definition) => ({ ...definition })));
    setGlobalInstructionsDraft(settings.agents.globalInstructions);
    setSelectedProviderId(providers[0]?.id ?? null);
    setConnectionDraft(null);
    setAgentManifestSaveState('idle');
    setAgentManifestSaveMessage('');
  }, [open, settings]);

  return {
    activeSection,
    setActiveSection,
    accountDraft,
    setAccountDraft,
    providerDrafts,
    setProviderDrafts,
    agentRouteDrafts,
    setAgentRouteDrafts,
    rdxCliDraft,
    setRdxCliDraft,
    rdxActionsDraft,
    setRdxActionsDraft,
    codeInterpreterDraft,
    setCodeInterpreterDraft,
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
    openRemoteCapture: cloneRdxAction(actions?.openRemoteCapture ?? defaultRdxAction()),
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
