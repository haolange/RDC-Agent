import { useCallback } from 'react';
import type { ConversationMessage } from '@shared/types/conversation';

export function useMessageActions() {
  const handleCopy = useCallback((content: string) => {
    navigator.clipboard.writeText(content).catch(() => { /* ignore */ });
  }, []);

  const handleEditResend = useCallback((content: string) => {
    // Dispatch a custom event that the composer can listen to
    window.dispatchEvent(new CustomEvent('message:edit-resend', { detail: { content } }));
  }, []);

  const handleShare = useCallback((message: ConversationMessage) => {
    const data = JSON.stringify({
      role: message.role,
      content: message.content,
      timestamp: message.createdAt,
    }, null, 2);
    navigator.clipboard.writeText(data).catch(() => { /* ignore */ });
  }, []);

  return { handleCopy, handleEditResend, handleShare };
}
