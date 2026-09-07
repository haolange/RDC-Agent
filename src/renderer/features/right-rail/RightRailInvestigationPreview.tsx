import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { bareInvestigationHash, type InvestigationReadIpcResult } from '@shared/types/renderdocInvestigation';
import type { InvestigationArtifactRow } from '@shared/types/trace';
import { useI18n, type TranslationKey } from '../../i18n';
import { copyAppText } from '../../hooks/appShellBridge';
import { readInvestigationArtifact } from './investigationPreviewActions';
import { Button } from '../../ui/Button';
import './RightRailInvestigationPreview.css';

type PreviewStatus = 'empty' | 'loading' | 'ready' | 'degraded' | 'error' | 'hash-mismatch';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const shortHash = (value: string): string => {
  const bare = bareInvestigationHash(value);
  return bare ? `sha256:${bare.slice(0, 12)}` : '';
};

export const RightRailInvestigationPreview: React.FC<{
  sessionId: string;
  row: InvestigationArtifactRow;
  onClose: () => void;
}> = ({ sessionId, row, onClose }) => {
  const { t } = useI18n();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const [status, setStatus] = useState<PreviewStatus>(row.contentHash ? 'loading' : 'empty');
  const [result, setResult] = useState<InvestigationReadIpcResult | null>(null);

  useEffect(() => {
    const previouslyFocused = previouslyFocusedRef.current;
    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((element) => !element.hasAttribute('aria-hidden'));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!row.contentHash) {
      setStatus('empty');
      setResult(null);
      return;
    }
    let cancelled = false;
    setStatus('loading');
    setResult(null);
    void readInvestigationArtifact({
      sessionId,
      artifactId: row.artifactId,
      expectedHash: row.contentHash,
    })?.then((payload) => {
      if (!payload) {
        if (cancelled) return;
        setStatus('error');
        setResult({ ok: false, status: 'error', errorCode: 'INVESTIGATION_SESSION_DENIED', error: 'investigation:read is unavailable' });
        return;
      }
      if (cancelled) return;
      setResult(payload);
      setStatus(payload.status);
    }).catch((error: unknown) => {
      if (cancelled) return;
      setResult({
        ok: false,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
      setStatus('error');
    });
    return () => {
      cancelled = true;
    };
  }, [row.artifactId, row.contentHash, sessionId]);

  const hash = result?.contentHash || row.contentHash;
  const manifest = result?.manifest;
  const heading = manifest?.title || row.title || row.artifactId;
  const statusLabel = t(`control.rightRail.artifacts.preview.state.${status}` as TranslationKey);
  const recordStatus = manifest?.status ?? row.status;
  const body = result?.record
    ? JSON.stringify(result.record, null, 2)
    : '';

  return createPortal(
    <div
      className="investigation-preview-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="investigation-preview-dialog"
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
        data-status={status}
      >
        <header className="investigation-preview-header">
          <div className="investigation-preview-heading">
            <h2 id={titleId}>{t('control.rightRail.artifacts.preview.title')}</h2>
            <p>{heading}</p>
          </div>
          <Button variant="ghost" size="sm" autoFocus onClick={onClose}>
            {t('control.rightRail.artifacts.preview.close')}
          </Button>
        </header>
        <dl className="investigation-preview-meta">
          <div>
            <dt>{t('control.rightRail.artifacts.preview.version')}</dt>
            <dd>{manifest?.createdAt ?? row.createdAt}</dd>
          </div>
          <div>
            <dt>{t('control.rightRail.artifacts.preview.status')}</dt>
            <dd>{t(`control.rightRail.artifacts.status.${recordStatus}` as TranslationKey)}</dd>
          </div>
          <div>
            <dt>{t('control.rightRail.artifacts.preview.degraded')}</dt>
            <dd>{t(row.degraded || status === 'degraded'
              ? 'control.rightRail.artifacts.preview.yes'
              : 'control.rightRail.artifacts.preview.no')}</dd>
          </div>
          <div>
            <dt>{t('control.rightRail.artifacts.preview.stateLabel')}</dt>
            <dd>{statusLabel}</dd>
          </div>
        </dl>
        <section className="investigation-preview-hash" aria-label={t('control.rightRail.artifacts.preview.hash')}>
          <strong>{shortHash(hash) || t('control.rightRail.artifacts.preview.hashMissing')}</strong>
          <Button
            variant="ghost"
            size="sm"
            disabled={!hash}
            onClick={() => void copyAppText(hash)}
          >
            {t('control.rightRail.artifacts.preview.copyHash')}
          </Button>
        </section>
        {result?.error ? (
          <p className="investigation-preview-error" role="alert">{result.error}</p>
        ) : null}
        {status === 'loading' ? (
          <p className="investigation-preview-message">{statusLabel}</p>
        ) : null}
        {status === 'empty' ? (
          <p className="investigation-preview-message">{t('control.rightRail.artifacts.preview.empty')}</p>
        ) : null}
        {body ? <pre className="investigation-preview-body">{body}</pre> : null}
        {manifest?.supersedes ? (
          <p className="investigation-preview-message">
            {t('control.rightRail.artifacts.preview.supersedes', { id: manifest.supersedes })}
          </p>
        ) : null}
      </div>
    </div>,
    document.body,
  );
};

export default RightRailInvestigationPreview;
