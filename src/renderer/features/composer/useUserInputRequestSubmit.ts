import { useCallback } from 'react';
import type { ConversationAskUserAnswer } from '@shared/types/conversation';
import type { PendingUserInputRequest } from './userInputRequestModel';

export const useUserInputRequestSubmit = () => useCallback(async (
  request: PendingUserInputRequest,
  answers: ConversationAskUserAnswer[],
): Promise<void> => {
  if (answers.length === 0) return;

  const electronAPI = window.electronAPI;
  if (!electronAPI) {
    throw new Error('Conversation API is not available.');
  }

  const result = await electronAPI.conversation.answerUserInput({
    sessionId: request.sessionId,
    turnId: request.turnId,
    toolCallId: request.toolCallId,
    answers,
  });
  if (!result.success) {
    throw new Error(result.error || 'Unable to submit the answer.');
  }
}, []);
