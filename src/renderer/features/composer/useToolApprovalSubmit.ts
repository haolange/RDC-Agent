import { useCallback } from 'react';
import { useConversationStore } from '../../stores/conversationStore';
import { useProjectStore } from '../../stores/projectStore';
import { findPendingToolApproval, type PendingToolApprovalRequest } from './toolApprovalRequestModel';

export const useToolApprovalSubmit = () =>
  useCallback(async (request: PendingToolApprovalRequest, approved: boolean): Promise<void> => {
    const current = () => {
      const pending = findPendingToolApproval(useConversationStore.getState().conversationMessages);
      return (
        useProjectStore.getState().currentSessionId === request.sessionId &&
        pending?.turnId === request.turnId &&
        pending.approvalId === request.approvalId
      );
    };
    if (!current()) return;
    try {
      await window.electronAPI.conversation.answerToolApproval({
        sessionId: request.sessionId,
        turnId: request.turnId,
        approvalId: request.approvalId,
        approved,
      });
    } catch (error) {
      // A decision for a request that is no longer the pending one has nothing left to report.
      if (current()) throw error;
    }
  }, []);
