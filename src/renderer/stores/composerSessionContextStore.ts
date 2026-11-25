import { create } from 'zustand';
import type { PendingAttachmentDraft } from '../types/attachments';

/** The turn the Composer sent and has not seen end. Its turn id is `conversationTurnIds(requestId).turnId`. */
export interface ActiveTurnContext {
  sessionId: string;
  projectId: string | null;
  requestId: string;
  agentId: string;
}

export type ActiveTurnOwnership = Pick<ActiveTurnContext, 'sessionId' | 'requestId' | 'agentId'>;

export interface LastSentPrompt {
  sessionId: string;
  projectId: string | null;
  prompt: string;
  attachments: PendingAttachmentDraft[];
  skillIds: string[];
  preserveDraft?: boolean;
}

export interface HandoffSuggestionRequest {
  sessionId: string;
  agentId: string;
  label: string;
  prompt: string;
  send: boolean;
  /** Recovery path: the approved, still-unsent plan revision this handoff executes. */
  approvedPlan?: { planId: string; revision: number; hash: string };
  /**
   * Plan approval: main committed the Agent switch, model and controls with the approval, so only the execute turn is
   * left; it is delivered while that approval decision is still the current one.
   */
  approval?: { reviewId: string; planId: string; revision: number; hash: string };
}

interface ComposerSessionContextState {
  activeTurn: ActiveTurnContext | null;
  lastSent: LastSentPrompt | null;
  isPromptSending: boolean;
  handoffSuggestionRequest: HandoffSuggestionRequest | null;

  beginTurn: (context: ActiveTurnContext) => void;
  /** Main committed the turn; a first turn also created its session, which now owns it. */
  bindCommittedSession: (ownership: ActiveTurnOwnership, committedSessionId: string) => void;
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
  bindCommittedSession: (ownership, committedSessionId) => {
    const current = get().activeTurn;
    if (!current || !ownsActiveTurn(current, ownership)) return;
    set({ activeTurn: { ...current, sessionId: committedSessionId } });
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
  if (lastSent.preserveDraft) return true;
  apply(lastSent);
  return true;
}
