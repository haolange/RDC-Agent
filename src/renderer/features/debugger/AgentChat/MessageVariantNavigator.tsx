import React, { useCallback, useMemo } from 'react';
import type { ConversationMessage } from '@shared/types/conversation';
import type { ConversationBranchState } from '@shared/types/conversationBranch';
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
  const setConversationMessages = useConversationStore((state) => state.setConversationMessages);
  const setBranchState = useConversationStore((state) => state.setBranchState);
  const setTracePresentation = useWorkflowStore((state) => state.setTracePresentation);

  const fork = useMemo(() => {
    if (!branchState) return null;
    const forkId = message.forkId ?? message.id;
    return branchState.forks.find((entry) => (
      entry.forkId === forkId
      || entry.branches.some((branch) => branch.anchorUserMessageId === message.id)
    )) ?? null;
  }, [branchState, message.forkId, message.id]);

  const navigator = useMemo(() => {
    if (!fork || fork.branches.length <= 1) return null;
    const activeIndex = Math.max(0, fork.branches.findIndex((branch) => branch.branchId === fork.activeBranchId));
    return {
      variantIndex: activeIndex,
      variantCount: fork.branches.length,
      activeBranchId: fork.activeBranchId,
    };
  }, [fork]);

  const switchVariant = useCallback(async (direction: -1 | 1) => {
    if (!fork || !navigator || !message.sessionId) return;
    const nextIndex = navigator.variantIndex + direction;
    if (nextIndex < 0 || nextIndex >= navigator.variantCount) return;
    const nextBranch = fork.branches[nextIndex];
    if (!nextBranch) return;

    const electronAPI = getElectronApi();
    if (!electronAPI) return;

    const result = await electronAPI.conversation.switchBranch({
      sessionId: message.sessionId,
      forkId: fork.forkId,
      branchId: nextBranch.branchId,
    });
    if (!result.success) return;
    setConversationMessages(result.messages);
    if (result.branchState) {
      setBranchState(result.branchState);
    }
    if (result.tracePresentation) {
      setTracePresentation(result.tracePresentation);
    }
  }, [fork, message.sessionId, navigator, setBranchState, setConversationMessages, setTracePresentation]);

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
