/**
 * ConfirmationDialog — 通用确认对话框。
 *
 * 用于需要用户确认的破坏性操作，支持键盘快捷键（Alt+A 确认，Alt+D 取消）。
 */
import React, { useEffect, useCallback } from 'react';
import './ConfirmationDialog.css';

interface ConfirmationDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  riskLevel?: 'low' | 'medium' | 'high';
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  riskLevel = 'medium',
  onConfirm,
  onCancel,
}) => {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'a') {
        e.preventDefault();
        onConfirm();
      } else if (e.altKey && e.key === 'd') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    },
    [onConfirm, onCancel],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="confirmation-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`confirmation-dialog risk-${riskLevel}`}>
        <h3 className="confirmation-title">{title}</h3>
        <p className="confirmation-message">{message}</p>
        {riskLevel !== 'low' && (
          <span className={`risk-badge risk-${riskLevel}`}>
            {riskLevel === 'high' ? '⚠ High Risk' : '⚡ Medium Risk'}
          </span>
        )}
        <div className="confirmation-actions">
          <button
            className="btn-confirm"
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
            <kbd>Alt+A</kbd>
          </button>
          <button className="btn-cancel" onClick={onCancel}>
            {cancelLabel}
            <kbd>Alt+D</kbd>
          </button>
        </div>
      </div>
    </div>
  );
};
