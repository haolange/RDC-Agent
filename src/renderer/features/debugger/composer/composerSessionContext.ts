import { create } from 'zustand';
import type { PendingAttachmentDraft } from '../../../app/bootstrap/types';

export interface ActiveTurnContext {
  sessionId: string;
  projectId: string | null;
  requestId: string;
  optimisticTurnId: string | null;
  realTurnId: string | null;
}

export interface LastSentPrompt {
  sessionId: string;
  projectId: string | null;
  prompt: string;
  attachments: PendingAttachmentDraft[];
  skillIds: string[];
}

interface ComposerSessionContextState {
  activeTurn: ActiveTurnContext | null;
  lastSent: LastSentPrompt | null;
  isPromptSending: boolean;

  beginTurn: (context: ActiveTurnContext) => void;
  setRealTurnId: (turnId: string) => void;
  clearActiveTurn: () => void;
  clearActiveTurnIfSession: (sessionId: string | null | undefined) => void;
  setLastSent: (lastSent: LastSentPrompt | null) => void;
  setIsPromptSending: (sending: boolean) => void;
  /** Session switch hygiene: drop in-flight send context for any session. */
  resetForSessionSwitch: () => void;
}

export const useComposerSessionContextStore = create<ComposerSessionContextState>((set, get) => ({
  activeTurn: null,
  lastSent: null,
  isPromptSending: false,

  beginTurn: (context) => set({ activeTurn: context }),
  setRealTurnId: (turnId) => {
    const current = get().activeTurn;
    if (!current) return;
    set({ activeTurn: { ...current, realTurnId: turnId } });
  },
  clearActiveTurn: () => set({ activeTurn: null }),
  clearActiveTurnIfSession: (sessionId) => {
    const current = get().activeTurn;
    if (current && sessionId && current.sessionId === sessionId) {
      set({ activeTurn: null });
    }
  },
  setLastSent: (lastSent) => set({ lastSent }),
  setIsPromptSending: (isPromptSending) => set({ isPromptSending }),
  resetForSessionSwitch: () => set({
    activeTurn: null,
    isPromptSending: false,
    // Keep lastSent for its owning session; restore path validates sessionId.
  }),
}));

/** Restore draft only when lastSent owns the current session. */
export function restoreLastSentIfCurrentSession(
  currentSessionId: string | null | undefined,
  apply: (lastSent: LastSentPrompt) => void,
): boolean {
  const lastSent = useComposerSessionContextStore.getState().lastSent;
  if (!lastSent || !currentSessionId || lastSent.sessionId !== currentSessionId) {
    return false;
  }
  apply(lastSent);
  return true;
}
