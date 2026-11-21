import React, { useCallback } from 'react';
import { useClipboardBridge } from '../../hooks/useClipboardBridge';
import { useI18n } from '../../i18n';
import { CopyButton } from '../../ui/CopyButton';
import { Icon } from '../../ui/Icon';
import { MessageVariantNavigator } from './MessageVariantNavigator';
import type { ConversationBranchState } from '@shared/types/conversationBranch';
import type { ConversationMessage } from '@shared/types/conversation';

interface MessageActionsProps {
  message: ConversationMessage;
  branchState?: ConversationBranchState | null;
  onCopy?: (content: string) => void | Promise<void>;
  onEditResend?: (content: string) => void;
}

export const MessageActions: React.FC<MessageActionsProps> = ({
  message,
  branchState = null,
  onCopy,
  onEditResend,
}) => {
  const { t } = useI18n();
  const { copyText } = useClipboardBridge();
  const editResendLabel = t('chat.editResend');

  const handleCopy = useCallback(async () => {
    if (!message.content) return false;
    const didCopy = await copyText(message.content);
    await onCopy?.(message.content);
    return didCopy;
  }, [copyText, message.content, onCopy]);

  const handleEditResend = useCallback(() => {
    if (onEditResend && message.content) {
      onEditResend(message.content);
    }
  }, [message.content, onEditResend]);

  return (
    <div className="message-actions" data-testid="message-actions">
      <CopyButton className="message-action-btn" onCopy={handleCopy} label={t('chat.copyMessage')} copiedLabel={t('chat.markdownCopied')} />
      {message.role === 'user' && onEditResend && (
        <button
          type="button"
          className="message-action-btn"
          data-tooltip={editResendLabel}
          aria-label={editResendLabel}
          onClick={handleEditResend}
        >
          <Icon name="edit" size={14} />
        </button>
      )}
      {message.role === 'user' ? (
        <MessageVariantNavigator message={message} branchState={branchState} />
      ) : null}
    </div>
  );
};
