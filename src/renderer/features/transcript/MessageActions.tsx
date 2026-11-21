import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useClipboardBridge } from '../../hooks/useClipboardBridge';
import { useI18n } from '../../i18n';
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
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);
  const copyLabel = t('chat.markdownCopyCode');
  const copiedLabel = t('chat.markdownCopied');
  const copyMessageLabel = t('chat.copyMessage');
  const editResendLabel = t('chat.editResend');

  useEffect(() => () => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
  }, []);

  const handleCopy = useCallback(async () => {
    if (!message.content) return;
    const didCopy = await copyText(message.content);
    await onCopy?.(message.content);
    if (!didCopy) return;
    setCopied(true);
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = window.setTimeout(() => setCopied(false), 1200);
  }, [copyText, message.content, onCopy]);

  const handleEditResend = useCallback(() => {
    if (onEditResend && message.content) {
      onEditResend(message.content);
    }
  }, [message.content, onEditResend]);

  return (
    <div className="message-actions" data-testid="message-actions">
      <button
        type="button"
        className="message-action-btn"
        data-copied={copied ? 'true' : 'false'}
        title={copied ? copiedLabel : copyLabel}
        aria-label={copied ? copiedLabel : copyMessageLabel}
        onClick={handleCopy}
      >
        <Icon name="copy" size={14} />
      </button>
      {message.role === 'user' && onEditResend && (
        <button
          type="button"
          className="message-action-btn"
          title={editResendLabel}
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
