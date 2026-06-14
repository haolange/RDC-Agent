import { useCallback } from 'react';
import type { PendingUserInputRequest } from './UserInputRequestPanel';

export const useUserInputRequestSubmit = () => useCallback(async (
  request: PendingUserInputRequest,
  answer: string,
): Promise<void> => {
  const trimmed = answer.trim();
  if (!trimmed) return;

  const electronAPI = window.electronAPI;
  if (!electronAPI) {
    throw new Error('Conversation API is not available.');
  }

  const result = await electronAPI.conversation.answerUserInput({
    sessionId: request.sessionId,
    turnId: request.turnId,
    toolCallId: request.toolCallId,
    answer: trimmed,
  });
  if (!result.success) {
    throw new Error(result.error || 'Unable to submit the answer.');
  }
}, []);
