import { create } from 'zustand';
import type { PendingAttachmentDraft } from '../types/attachments';

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

export interface HandoffSuggestionRequest {
  sessionId: string;
  agentId: string;
  prompt: string;
  send: boolean;
}

interface ComposerSessionContextState {
  activeTurn: ActiveTurnContext | null;
  lastSent: LastSentPrompt | null;
  isPromptSending: boolean;
  handoffSuggestionRequest: HandoffSuggestionRequest | null;

  beginTurn: (context: ActiveTurnContext) => void;
  setRealTurnId: (
    ownership: ActiveTurnOwnership,
    turnId: string,
    committedSessionId?: string | null,
  ) => void;
  clearActiveTurnIfOwned: (ownership: ActiveTurnOwnership) => void;
  setLastSent: (lastSent: LastSentPrompt | null) => void;
  setIsPromptSending: (sending: boolean) => void;
  queueHandoffSuggestion: (request: HandoffSuggestionRequest) => void;
  clearHandoffSuggestion: () => void;
  resetForSessionSwitch: () => void;
}

export const useComposerSessionContextStore = create<ComposerSessionContextState>((set, get) => ({
  activeTurn: null,
  lastSent: null,
  isPromptSending: false,
  handoffSuggestionRequest: null,

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
  queueHandoffSuggestion: (handoffSuggestionRequest) => {
    const state = get();
    if (state.handoffSuggestionRequest || state.activeTurn || state.isPromptSending) return;
    set({ handoffSuggestionRequest });
  },
  clearHandoffSuggestion: () => set({ handoffSuggestionRequest: null }),
  resetForSessionSwitch: () => set({
    activeTurn: null,
    isPromptSending: false,
    handoffSuggestionRequest: null,
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
