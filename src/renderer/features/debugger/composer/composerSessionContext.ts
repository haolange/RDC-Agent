import { create } from 'zustand';
import type { PendingAttachmentDraft } from '../../../app/bootstrap/types';

export interface ActiveTurnContext {
  sessionId: string;
  projectId: string | null;
  requestId: string;
  agentId: string;
  optimisticTurnId: string | null;
  realTurnId: string | null;
}

export type ActiveTurnOwnership = Pick<ActiveTurnContext, 'sessionId' | 'requestId' | 'agentId'>;

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
  setRealTurnId: (
    ownership: ActiveTurnOwnership,
    turnId: string,
    committedSessionId?: string | null,
  ) => void;
  clearActiveTurnIfOwned: (ownership: ActiveTurnOwnership) => void;
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
  setRealTurnId: (ownership, turnId, committedSessionId) => {
    const current = get().activeTurn;
    if (!current || !ownsActiveTurn(current, ownership)) return;
    set({
      activeTurn: {
        ...current,
        sessionId: committedSessionId ?? current.sessionId,
        realTurnId: turnId,
      },
    });
  },
  clearActiveTurnIfOwned: (ownership) => {
    const current = get().activeTurn;
    if (current && ownsActiveTurn(current, ownership)) {
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

export function ownsActiveTurn(
  activeTurn: ActiveTurnContext,
  ownership: ActiveTurnOwnership,
): boolean {
  return activeTurn.sessionId === ownership.sessionId
    && activeTurn.requestId === ownership.requestId
    && activeTurn.agentId === ownership.agentId;
}

function normalizeComposerSessionOwner(sessionId: string | null | undefined): string {
  return sessionId && sessionId !== 'no-session' ? sessionId : 'no-session';
}

/** Restore draft only when lastSent owns the current session. */
export function restoreLastSentIfCurrentSession(
  currentSessionId: string | null | undefined,
  apply: (lastSent: LastSentPrompt) => void,
): boolean {
  const lastSent = useComposerSessionContextStore.getState().lastSent;
  if (!lastSent) return false;
  if (normalizeComposerSessionOwner(currentSessionId) !== normalizeComposerSessionOwner(lastSent.sessionId)) {
    return false;
  }
  apply(lastSent);
  return true;
}
