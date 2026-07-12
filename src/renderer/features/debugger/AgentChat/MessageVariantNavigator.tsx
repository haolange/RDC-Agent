import React, { useCallback, useMemo } from 'react';
import type { ConversationMessage } from '@shared/types/conversation';
import type { ConversationBranchState } from '@shared/types/conversationBranch';
import {
  findForkForVisibleUserMessage,
  getConcreteForkBranches,
  shouldShowForkNavigatorForMessage,
} from '@shared/conversation/conversationBranchResolver';
import { getElectronApi } from '../../../platform/getElectronApi';
import { useConversationStore } from '../../../stores/conversationStore';
import { useWorkflowStore } from '../../../stores/workflowStore';
import { useI18n } from '../../../i18n';

interface MessageVariantNavigatorProps {
  message: ConversationMessage;
  branchState: ConversationBranchState | null;
}

export const MessageVariantNavigator: React.FC<MessageVariantNavigatorProps> = ({
  message,
  branchState,
}) => {
  const { t } = useI18n();
  const setConversationSnapshot = useConversationStore((state) => state.setConversationSnapshot);
  const setTracePresentation = useWorkflowStore((state) => state.setTracePresentation);

  const fork = useMemo(() => {
    if (!branchState || !shouldShowForkNavigatorForMessage(branchState, message)) {
      return null;
    }
    return findForkForVisibleUserMessage(branchState, message);
  }, [branchState, message]);

  const navigator = useMemo(() => {
    if (!fork) return null;
    const concreteBranches = getConcreteForkBranches(fork);
    if (concreteBranches.length <= 1) return null;
    const activeIndex = Math.max(
      0,
      concreteBranches.findIndex((branch) => branch.branchId === fork.activeBranchId),
    );
    return {
      variantIndex: activeIndex,
      variantCount: concreteBranches.length,
      branches: concreteBranches,
      activeBranchId: fork.activeBranchId,
    };
  }, [fork]);

  const switchVariant = useCallback(async (direction: -1 | 1) => {
    if (!fork || !navigator || !message.sessionId) return;
    const nextIndex = navigator.variantIndex + direction;
    if (nextIndex < 0 || nextIndex >= navigator.variantCount) return;
    const nextBranch = navigator.branches[nextIndex];
    if (!nextBranch) return;

    const electronAPI = getElectronApi();
    if (!electronAPI) return;

    const result = await electronAPI.conversation.switchBranch({
      sessionId: message.sessionId,
      forkId: fork.forkId,
      branchId: nextBranch.branchId,
    });
    if (!result.success) return;
    setConversationSnapshot(result.messages, result.branchState ?? null);
    if (result.tracePresentation) {
      setTracePresentation(result.tracePresentation);
    }
  }, [fork, message.sessionId, navigator, setConversationSnapshot, setTracePresentation]);

  if (!navigator) return null;

  return (
    <div className="message-variant-navigator" data-testid="message-variant-navigator">
      <button
        type="button"
        className="message-variant-nav-btn"
        aria-label={t('chat.messageVariantPrev')}
        disabled={navigator.variantIndex <= 0}
        onClick={() => void switchVariant(-1)}
      >
        ‹
      </button>
      <span className="message-variant-nav-label" aria-live="polite">
        {t('chat.messageVariantLabel', {
          current: navigator.variantIndex + 1,
          total: navigator.variantCount,
        })}
      </span>
      <button
        type="button"
        className="message-variant-nav-btn"
        aria-label={t('chat.messageVariantNext')}
        disabled={navigator.variantIndex >= navigator.variantCount - 1}
        onClick={() => void switchVariant(1)}
      >
        ›
      </button>
    </div>
  );
};
