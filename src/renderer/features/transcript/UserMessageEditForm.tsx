import React, { useEffect, useRef } from 'react';
import { useI18n } from '../../i18n';
import { Textarea } from '../../ui/Textarea';
import { Button } from '../../ui/Button';

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
      <Textarea
        ref={textareaRef}
        className="conversation-edit-textarea"
        value={value}
        disabled={submitting}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
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
        <Button type="button" variant="secondary" disabled={submitting} onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button type="submit" variant="primary" disabled={submitting || !value.trim()}>
          {submitting ? sendingLabel : sendLabel}
        </Button>
      </div>
    </form>
  );
};
