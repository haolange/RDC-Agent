import { useEffect, type RefObject } from 'react';
import type { AgentMode } from '@shared/types/layout';
import type { AgentManifestDefinition } from '@shared/types/agentManifest';
import { assignDynStyle } from '../../../lib/useDynStyle';

export function useComposerDomEffects(input: {
  promptInputRef: RefObject<HTMLTextAreaElement | null>;
  currentMode: AgentMode;
  promptValue: string;
  selectedAgentId: string;
  userInvocableAgents: AgentManifestDefinition[];
  setSelectedAgentId: (agentId: string) => void;
  setCurrentMode: (mode: AgentMode) => void;
}): void {
  const {
    promptInputRef,
    currentMode,
    promptValue,
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

  useEffect(() => {
    const textarea = promptInputRef.current;
    if (!textarea) return;

    // Keep parity with .composer-textarea min-height (72) so enabling Composer
    // Markdown (overlay capsule) never looks like a shell resize.
    assignDynStyle(textarea, { height: '0px' });
    const next = Math.min(Math.max(textarea.scrollHeight, 72), 180);
    assignDynStyle(textarea, { height: `${next}px` });
  }, [currentMode, promptInputRef, promptValue]);
}
