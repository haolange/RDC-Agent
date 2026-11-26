import { useCallback } from 'react';
import type { ConversationAskUserAnswer } from '@shared/types/conversation';
import type { PendingUserInputRequest } from './userInputRequestModel';

export const useUserInputRequestSubmit = () =>
  useCallback(async (request: PendingUserInputRequest, answers: ConversationAskUserAnswer[]): Promise<void> => {
    if (answers.length === 0) return;

    // A rejected answer fails with USER_INPUT_ANSWER_INVALID, naming its question in the error's params.
    await window.electronAPI.conversation.answerUserInput({
      sessionId: request.sessionId,
      turnId: request.turnId,
      toolCallId: request.toolCallId,
      answers,
    });
  }, []);
