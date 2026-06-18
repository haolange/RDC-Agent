import React, { useEffect, useRef } from 'react';
import { useI18n } from '../../../i18n';

interface UserMessageEditFormProps {
  value: string;
  error: string;
  submitting: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

export const UserMessageEditForm: React.FC<UserMessageEditFormProps> = ({
  value,
  error,
  submitting,
  onChange,
  onCancel,
  onSubmit,
}) => {
  const { language } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cancelLabel = language === 'zh-CN' ? '取消' : 'Cancel';
  const sendLabel = language === 'zh-CN' ? '发送' : 'Send';
  const sendingLabel = language === 'zh-CN' ? '发送中' : 'Sending';

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const nextHeight = Math.min(textarea.scrollHeight, 260);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > 260 ? 'auto' : 'hidden';
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
