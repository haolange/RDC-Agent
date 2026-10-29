import { useCallback } from 'react';
import { findPendingToolApproval, type PendingToolApprovalRequest } from './toolApprovalRequestModel';
import { useConversationStore } from '../../stores/conversationStore';
import { useProjectStore } from '../../stores/projectStore';

export const useToolApprovalSubmit = () => useCallback(async (
  request: PendingToolApprovalRequest,
  approved: boolean,
): Promise<void> => {
  const electronAPI = window.electronAPI;
  if (!electronAPI) {
    throw new Error('Conversation API is not available.');
  }

  const current = () => {
    const pending = findPendingToolApproval(useConversationStore.getState().conversationMessages);
    return useProjectStore.getState().currentSession?.sessionId === request.sessionId && pending?.turnId === request.turnId && pending.approvalId === request.approvalId;
  };
  if (!current()) return;
  const result = await electronAPI.conversation.answerToolApproval({
    sessionId: request.sessionId,
    turnId: request.turnId,
    approvalId: request.approvalId,
    approved,
  });
  if (!result.success && current()) {
    throw new Error(result.error || 'Unable to submit the approval decision.');
  }
}, []);
