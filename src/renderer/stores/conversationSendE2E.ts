import type { ConversationMessage } from '@shared/types/conversation';
import type { ConversationBranchState } from '@shared/types/conversationBranch';
import type { AgentRunPresentation } from '@shared/types/agenticTrace';

export async function syncE2EConversationState(options: {
  electronAPI: NonNullable<Window['electronAPI']>;
  sessionId: string | null | undefined;
  turnId: string;
  setConversationMessages: (messages: ConversationMessage[]) => void;
  setTracePresentation: (presentation: AgentRunPresentation | null) => void;
  setBranchState?: (branchState: ConversationBranchState | null) => void;
  shouldApply?: () => boolean;
}) {
  const {
    electronAPI,
    sessionId,
    turnId,
    setConversationMessages,
    setTracePresentation,
    setBranchState,
    shouldApply,
  } = options;

  if (typeof navigator === 'undefined' || !navigator.webdriver || !sessionId) {
    return;
  }

  const maxAttempts = 40;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const historyResult = await electronAPI.conversation.getHistory(sessionId).catch(() => ({ messages: [] }));
    const history = historyResult.messages ?? [];
    const assistantForTurn = history.find((message) => message.turnId === turnId && message.role === 'assistant');
    const done = assistantForTurn && ['complete', 'error', 'stopped'].includes(assistantForTurn.status ?? 'draft');
    if (done) {
      if (shouldApply && !shouldApply()) {
        return;
      }
      setConversationMessages(history);
      if (setBranchState && 'branchState' in historyResult) {
        setBranchState(historyResult.branchState ?? null);
      }
      const workflowPresentation = await electronAPI.trace.getProjection(sessionId).catch(() => null);
      if (workflowPresentation?.presentation) {
        setTracePresentation(workflowPresentation.presentation);
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
