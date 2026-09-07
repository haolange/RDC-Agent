import React, { useEffect, useRef } from 'react';
import { useI18n } from '../../i18n';
import { assignDynStyle } from '../../lib/useDynStyle';

interface UserMessageEditFormProps {
  value: string;
  error: string;
  submitting: boolean;
  executionPreview: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

export const UserMessageEditForm: React.FC<UserMessageEditFormProps> = ({
  value,
  error,
  submitting,
  executionPreview,
  onChange,
  onCancel,
  onSubmit,
}) => {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cancelLabel = t('chat.rewriteCancel');
  const sendLabel = t('chat.rewriteSend');
  const sendingLabel = t('chat.rewriteSending');

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    assignDynStyle(textarea, { height: 'auto', 'overflow-y': 'hidden' });
    const nextHeight = Math.min(textarea.scrollHeight, 260);
    assignDynStyle(textarea, {
      height: `${nextHeight}px`,
      'overflow-y': textarea.scrollHeight > 260 ? 'auto' : 'hidden',
    });
  }, [value]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <form className="conversation-edit-form" onSubmit={submit}>
      <p className="conversation-edit-preview" data-testid="conversation-edit-preview">{executionPreview}</p>
      <textarea
        ref={textareaRef}
        className="input conversation-edit-textarea"
        value={value}
        rows={2}
        disabled={submitting}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onSubmit();
          }
        }}
      />
      {error ? <div className="conversation-edit-error">{error}</div> : null}
      <div className="conversation-edit-actions">
        <button type="button" className="button button-secondary" disabled={submitting} onClick={onCancel}>
          {cancelLabel}
        </button>
        <button type="submit" className="button button-primary" disabled={submitting || !value.trim()}>
          {submitting ? sendingLabel : sendLabel}
        </button>
      </div>
    </form>
  );
};
