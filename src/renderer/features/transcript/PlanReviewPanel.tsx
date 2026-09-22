import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ConversationPlanReview } from '@shared/types/planReview';
import { useI18n } from '../../i18n';
import { useModalFocus } from '../../lib/useModalFocus';
import { useOverlayLayer } from '../../lib/overlayStack';
import { Icon } from '../../ui/Icon';
import { IconButton } from '../../ui/IconButton';
import { MessageMarkdown } from '../../patterns/Markdown/MessageMarkdown';
import { usePlanReviewActions } from './usePlanReviewActions';
import { useProjectStore } from '../../stores/projectStore';
import { useReadingPanelGeometry } from '../../lib/useReadingPanelGeometry';
import './plan-review-panel.css';

export const PlanReviewPanel: React.FC<{
  plan: ConversationPlanReview;
  onClose: () => void;
}> = ({ plan, onClose }) => {
  const { t } = useI18n();
  const titleId = useId();
  const geometry = useReadingPanelGeometry();
  const dialogRef = useRef<HTMLDivElement>(null);
  const { layerId } = useOverlayLayer(true);
  useModalFocus({ open: geometry.ready, containerRef: dialogRef, onClose, layerId });
  const sessionId = useProjectStore((state) => state.currentSession?.sessionId);
  const { readPlan, copyPlan, saveToProject, exportPlan } = usePlanReviewActions();
  const [markdown, setMarkdown] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const initialSession = useRef(sessionId);
  const reference = { sessionId: sessionId!, planId: plan.planId, revision: plan.revision, uri: plan.uri, expectedHash: plan.hash };

  useEffect(() => {
    if (!sessionId || initialSession.current !== sessionId) { onClose(); return; }
    setMarkdown('');
    setError(null);
    setLoading(true);
    let cancelled = false;
    void readPlan({ sessionId, planId: plan.planId, revision: plan.revision, uri: plan.uri, expectedHash: plan.hash })
      .then((result) => {
        if (!cancelled) setMarkdown(result.markdown);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      }).finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
    };
  }, [sessionId, plan.planId, plan.revision, plan.uri, plan.hash, readPlan, onClose]);

  const runAction = async (action: () => Promise<boolean>, message: string) => {
    if (!sessionId || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (await action()) setNotice(message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  if (typeof document === 'undefined' || !geometry.ready) return null;

  return createPortal(
    <div
      className="plan-review-panel-overlay"
      {...geometry.style}
      data-overlay-layer
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="plan-review-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="plan-review-panel"
      >
        <header className="plan-review-panel__header">
          <div className="plan-review-panel__heading">
            <h2 id={titleId} className="plan-review-panel__title">{plan.title}</h2>
            <span className="plan-review-panel__revision">{t('chat.planReviewRevision', { revision: plan.revision })}</span>
          </div>
          <div className="plan-review-panel__actions">
            <IconButton
              label={t('chat.planReviewExport')}
              size="sm"
              disabled={busy || loading || !markdown || !sessionId}
              onClick={() => void runAction(() => exportPlan(reference), t('chat.planReviewExported'))}
            >
              <Icon name="upload" size={14} />
            </IconButton>
            <IconButton
              label={t('chat.planReviewSave')}
              size="sm"
              disabled={busy || loading || !markdown || !sessionId}
              onClick={() => void runAction(() => saveToProject(reference), t('chat.planReviewSaved'))}
            >
              <Icon name="folder" size={14} />
            </IconButton>
            <IconButton
              label={t('chat.planReviewCopy')}
              size="sm"
              disabled={busy || !markdown}
              onClick={() => void runAction(() => copyPlan(markdown), t('chat.planReviewCopied'))}
            >
              <Icon name="copy" size={14} />
            </IconButton>
            <IconButton label={t('chat.planReviewClose')} size="sm" onClick={onClose}>
              <Icon name="close" size={14} />
            </IconButton>
          </div>
        </header>
        {notice ? <p className="plan-review-panel__notice" role="status">{notice}</p> : null}
        {error ? <p className="plan-review-panel__error" role="alert">{error}</p> : null}
        <div className="plan-review-panel__body" aria-busy={loading}>
          {loading ? <p role="status">{t('chat.planReviewLoading')}</p> : markdown ? <MessageMarkdown content={markdown} /> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
};
