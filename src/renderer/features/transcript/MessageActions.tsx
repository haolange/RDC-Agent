import React, { useCallback } from 'react';
import { useClipboardBridge } from '../../hooks/useClipboardBridge';
import { useI18n } from '../../i18n';
import { CopyButton } from '../../ui/CopyButton';
import { Icon } from '../../ui/Icon';
import { PlainButton } from '../../ui/PlainButton';
import { MessageVariantNavigator } from './MessageVariantNavigator';
import type { ConversationBranchState } from '@shared/types/conversationBranch';
import type { ConversationMessage } from '@shared/types/conversation';

interface MessageActionsProps {
  message: ConversationMessage;
  branchState?: ConversationBranchState | null;
  onEditResend?: (content: string) => void;
}

export const MessageActions: React.FC<MessageActionsProps> = ({ message, branchState = null, onEditResend }) => {
  const { t } = useI18n();
  const { copyText } = useClipboardBridge();
  const editResendLabel = t('chat.editResend');

  const handleCopy = useCallback(async () => {
    if (!message.content) return false;
    return copyText(message.content);
  }, [copyText, message.content]);

  const handleEditResend = useCallback(() => {
    if (onEditResend && message.content) {
      onEditResend(message.content);
    }
  }, [message.content, onEditResend]);

  return (
    <div className="message-actions" data-testid="message-actions">
      <CopyButton
        className="message-action-btn"
        onCopy={handleCopy}
        label={t('chat.copyMessage')}
        copiedLabel={t('chat.markdownCopied')}
      />
      {message.role === 'user' && onEditResend && (
        <PlainButton
          className="message-action-btn"
          data-tooltip={editResendLabel}
          aria-label={editResendLabel}
          onClick={handleEditResend}
        >
          <Icon name="edit" size={14} />
        </PlainButton>
      )}
      {message.role === 'user' ? <MessageVariantNavigator message={message} branchState={branchState} /> : null}
    </div>
  );
};
