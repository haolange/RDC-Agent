import React, { useCallback, useMemo } from 'react';
import {
  findForkForVisibleUserMessage,
  getConcreteForkBranches,
  shouldShowForkNavigatorForMessage,
} from '@shared/conversation/conversationBranchResolver';
import { switchConversationBranch } from '../../hooks/conversationPreview';
import { hydrateLoadedSessionSurface } from '../../stores/sessionProjectionHydration';
import { useI18n } from '../../i18n';
import { notify } from '../../stores/notificationStore';
import { Chevron } from '../../ui/Chevron';
import { PlainButton } from '../../ui/PlainButton';
import type { ConversationBranchState } from '@shared/types/conversationBranch';
import type { ConversationMessage } from '@shared/types/conversation';

interface MessageVariantNavigatorProps {
  message: ConversationMessage;
  branchState: ConversationBranchState | null;
}

export const MessageVariantNavigator: React.FC<MessageVariantNavigatorProps> = ({ message, branchState }) => {
  const { t } = useI18n();

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

  const switchVariant = useCallback(
    async (direction: -1 | 1) => {
      if (!fork || !navigator || !message.sessionId) return;
      const nextIndex = navigator.variantIndex + direction;
      if (nextIndex < 0 || nextIndex >= navigator.variantCount) return;
      const nextBranch = navigator.branches[nextIndex];
      if (!nextBranch) return;

      let result: Awaited<ReturnType<typeof switchConversationBranch>>;
      try {
        result = await switchConversationBranch({
          sessionId: message.sessionId,
          forkId: fork.forkId,
          branchId: nextBranch.branchId,
        });
      } catch (error) {
        // A switch that did not happen says so; silently staying on the old branch reads as a broken control.
        notify.failure(error, t, 'chat.messageVariantSwitchFailed');
        return;
      }
      if (!result) {
        notify.error(t('chat.messageVariantSwitchFailed'));
        return;
      }
      hydrateLoadedSessionSurface({
        sessionId: message.sessionId,
        messages: result.messages,
        branchState: result.branchState,
        tracePresentation: result.tracePresentation,
        applyTrace: true,
      });
    },
    [fork, message.sessionId, navigator, t],
  );

  if (!navigator) return null;

  return (
    <div className="message-variant-navigator" data-testid="message-variant-navigator">
      <PlainButton
        className="message-variant-nav-btn"
        aria-label={t('chat.messageVariantPrev')}
        disabled={navigator.variantIndex <= 0}
        onClick={() => void switchVariant(-1)}
      >
        <Chevron direction="left" size={12} />
      </PlainButton>
      <span className="message-variant-nav-label" aria-live="polite">
        {t('chat.messageVariantLabel', {
          current: navigator.variantIndex + 1,
          total: navigator.variantCount,
        })}
      </span>
      <PlainButton
        className="message-variant-nav-btn"
        aria-label={t('chat.messageVariantNext')}
        disabled={navigator.variantIndex >= navigator.variantCount - 1}
        onClick={() => void switchVariant(1)}
      >
        <Chevron size={12} />
      </PlainButton>
    </div>
  );
};
