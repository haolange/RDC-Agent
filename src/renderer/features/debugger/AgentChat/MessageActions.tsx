import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationMessage } from '@shared/types/conversation';
import { getElectronApi } from '../../../platform/getElectronApi';
import { useI18n } from '../../../i18n';

interface MessageActionsProps {
  message: ConversationMessage;
  onCopy?: (content: string) => void | Promise<void>;
  onEditResend?: (content: string) => void;
}

export const MessageActions: React.FC<MessageActionsProps> = ({
  message,
  onCopy,
  onEditResend,
}) => {
  const { language } = useI18n();
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);
  const copyLabel = language === 'zh-CN' ? '复制' : 'Copy';
  const copiedLabel = language === 'zh-CN' ? '已复制' : 'Copied';
  const copyMessageLabel = language === 'zh-CN' ? '复制消息' : 'Copy message';
  const editResendLabel = language === 'zh-CN' ? '编辑并重新发送' : 'Edit and resend';

  useEffect(() => () => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
  }, []);

  const handleCopy = useCallback(async () => {
    if (!message.content) return;
    let didCopy = false;
    try {
      await getElectronApi()?.appShell.copyText(message.content);
      didCopy = true;
    } catch {
      didCopy = false;
    }
    if (!didCopy) {
      try {
        await navigator.clipboard.writeText(message.content);
        didCopy = true;
      } catch {
        didCopy = false;
      }
    }
    await onCopy?.(message.content);
    if (!didCopy) return;
    setCopied(true);
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = window.setTimeout(() => setCopied(false), 1200);
  }, [message.content, onCopy]);

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
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      </button>
      {message.role === 'user' && (
        <button
          type="button"
          className="message-action-btn"
          title={editResendLabel}
          aria-label={editResendLabel}
          onClick={handleEditResend}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
      )}
    </div>
  );
};
