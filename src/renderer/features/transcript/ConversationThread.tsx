import React, { useCallback } from 'react';
import { selectOrderedConversationMessages, useConversationStore } from '../../stores/conversationStore';
import { EmptyWorkbenchPrompt } from '../../patterns/EmptyWorkbenchPrompt';
import { useWorkbenchSetup } from '../../hooks/useWorkbenchSetup';
import { useI18n } from '../../i18n';
import { Skeleton } from '../../ui/Skeleton';
import { VirtualMessageList } from './VirtualMessageList';
import { MessageBubble } from './MessageBubble';
import type { ConversationMessage } from '@shared/types/conversation';
import type { AgentMode } from '@shared/types/layout';

interface ConversationThreadProps {
  mode: AgentMode;
}

export const ConversationThread: React.FC<ConversationThreadProps> = ({ mode }) => {
  // Write-side sort already applied in conversationStore; selector stays shallow-stable.
  const orderedMessages = useConversationStore(selectOrderedConversationMessages);
  const historyLoading = useConversationStore((state) => state.historyLoadingSessionId !== null);
  const setup = useWorkbenchSetup();
  const { t } = useI18n();

  const renderMessage = useCallback((message: ConversationMessage) => <MessageBubble message={message} />, []);

  // While a session's saved history is read, the transcript holds its place instead of flashing the empty home.
  if (orderedMessages.length === 0 && historyLoading) {
    return (
      <div
        className="conversation-thread conversation-thread-loading"
        data-testid="conversation-thread"
        role="status"
        aria-label={t('chat.historyLoading')}
      >
        <Skeleton shape="card" count={3} />
      </div>
    );
  }

  if (orderedMessages.length === 0) {
    return (
      <div className="conversation-thread conversation-thread-empty" data-testid="conversation-thread">
        <EmptyWorkbenchPrompt mode={mode} setup={setup} />
      </div>
    );
  }

  return (
    <VirtualMessageList
      messages={orderedMessages}
      renderMessage={renderMessage}
      className="conversation-thread"
      data-testid="conversation-thread"
    />
  );
};

export default ConversationThread;
