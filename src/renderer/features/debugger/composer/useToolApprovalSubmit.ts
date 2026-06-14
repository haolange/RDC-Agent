import { useCallback } from 'react';
import type { PendingToolApprovalRequest } from './ToolApprovalRequestPanel';

export const useToolApprovalSubmit = () => useCallback(async (
  request: PendingToolApprovalRequest,
  approved: boolean,
): Promise<void> => {
  const electronAPI = window.electronAPI;
  if (!electronAPI) {
    throw new Error('Conversation API is not available.');
  }

  const result = await electronAPI.conversation.answerToolApproval({
    sessionId: request.sessionId,
    turnId: request.turnId,
    approvalId: request.approvalId,
    approved,
  });
  if (!result.success) {
    throw new Error(result.error || 'Unable to submit the approval decision.');
  }
}, []);
