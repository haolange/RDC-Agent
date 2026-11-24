import { useState } from 'react';
import { accessAttachment } from '../../hooks/conversationPreview';
import type { AttachmentOwner } from '@shared/types/conversation';
import type { AttachmentError } from './attachmentItem';

export function useAttachmentAction(owner: AttachmentOwner | null) {
  const [operation, setOperation] = useState<{ owner: AttachmentOwner; error?: AttachmentError } | null>(null);
  const current = operation?.owner === owner ? operation : null;
  const pending = Boolean(current && !current.error);
  const run = async (action: 'open' | 'reveal') => {
    if (!owner || pending) return;
    const started = { owner };
    setOperation(started);
    const result = await accessAttachment({ owner, action });
    setOperation((latest) => {
      if (latest !== started) return latest;
      return result.kind === 'error' ? { owner, error: result.code } : null;
    });
  };
  return { pending, error: current?.error ?? null, run };
}
