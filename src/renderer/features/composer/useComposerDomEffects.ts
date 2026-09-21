import { useEffect } from 'react';
import type { AgentMode } from '@shared/types/layout';
import type { AgentManifestDefinition } from '@shared/types/agentManifest';

export function useComposerDomEffects(input: {
  selectedAgentId: string;
  userInvocableAgents: AgentManifestDefinition[];
  setSelectedAgentId: (agentId: string) => void;
  setCurrentMode: (mode: AgentMode) => void;
}): void {
  const {
    selectedAgentId,
    userInvocableAgents,
    setSelectedAgentId,
    setCurrentMode,
  } = input;

  useEffect(() => {
    const fallback = userInvocableAgents[0];
    if (!fallback || userInvocableAgents.some((agent) => agent.id === selectedAgentId)) return;
    setSelectedAgentId(fallback.id);
    setCurrentMode(fallback.id as AgentMode);
  }, [selectedAgentId, setCurrentMode, setSelectedAgentId, userInvocableAgents]);

}
