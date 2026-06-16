import React, { useCallback } from 'react';
import type { ConversationMessage } from '@shared/types/conversation';

interface MessageActionsProps {
  message: ConversationMessage;
  onCopy?: (content: string) => void;
  onEditResend?: (content: string) => void;
  onShare?: (message: ConversationMessage) => void;
}

export const MessageActions: React.FC<MessageActionsProps> = ({
  message,
  onCopy,
  onEditResend,
  onShare,
}) => {
  const handleCopy = useCallback(() => {
    if (onCopy && message.content) {
      onCopy(message.content);
    }
    navigator.clipboard.writeText(message.content).catch(() => { /* ignore */ });
  }, [message.content, onCopy]);

  const handleEditResend = useCallback(() => {
    if (onEditResend && message.content) {
      onEditResend(message.content);
    }
  }, [message.content, onEditResend]);

  const handleShare = useCallback(() => {
    if (onShare) {
      onShare(message);
    }
  }, [message, onShare]);

  return (
    <div className="message-actions" data-testid="message-actions">
      <button
        type="button"
        className="message-action-btn"
        title="Copy"
        aria-label="Copy message"
        onClick={handleCopy}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      </button>
      {message.role === 'user' && (
        <button
          type="button"
          className="message-action-btn"
          title="Edit and resend"
          aria-label="Edit and resend"
          onClick={handleEditResend}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
      )}
      <button
        type="button"
        className="message-action-btn"
        title="Share"
        aria-label="Share message"
        onClick={handleShare}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
      </button>
    </div>
  );
};
