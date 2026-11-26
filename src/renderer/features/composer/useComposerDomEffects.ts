import { useEffect } from 'react';
import type { AgentManifestDefinition } from '@shared/types/agentManifest';

export function useComposerDomEffects(input: {
  selectedAgentId: string;
  userInvocableAgents: AgentManifestDefinition[];
  setSelectedAgentId: (agentId: string) => void;
}): void {
  const { selectedAgentId, userInvocableAgents, setSelectedAgentId } = input;

  useEffect(() => {
    const fallback = userInvocableAgents[0];
    if (!fallback || userInvocableAgents.some((agent) => agent.id === selectedAgentId)) return;
    setSelectedAgentId(fallback.id);
  }, [selectedAgentId, setSelectedAgentId, userInvocableAgents]);
}
