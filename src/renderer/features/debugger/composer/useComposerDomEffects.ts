import { useEffect, type RefObject } from 'react';
import type { AgentMode } from '@shared/types/layout';
import type { AgentManifestDefinition } from '@shared/types/agentManifest';
import { assignDynStyle } from '../../../lib/useDynStyle';

export function useComposerDomEffects(input: {
  modeMenuOpen: boolean;
  setModeMenuOpen: (open: boolean) => void;
  modeMenuRef: RefObject<HTMLDivElement | null>;
  promptInputRef: RefObject<HTMLTextAreaElement | null>;
  currentMode: AgentMode;
  promptValue: string;
  selectedAgentId: string;
  userInvocableAgents: AgentManifestDefinition[];
  setSelectedAgentId: (agentId: string) => void;
  setCurrentMode: (mode: AgentMode) => void;
}): void {
  const {
    modeMenuOpen,
    setModeMenuOpen,
    modeMenuRef,
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
    if (!modeMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!modeMenuRef.current?.contains(target)) {
        setModeMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setModeMenuOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [modeMenuOpen, modeMenuRef, setModeMenuOpen]);

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
