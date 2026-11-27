import React, { useEffect, useMemo, useRef, useState } from 'react';
import { splitPlanAppendix } from '@shared/utils/planAppendix';
import { useI18n } from '../../i18n';
import { Icon } from '../../ui/Icon';
import { IconButton } from '../../ui/IconButton';
import { MessageMarkdown } from '../../patterns/Markdown/MessageMarkdown';
import { PlanAuthorizationList } from '../../patterns/PlanAuthorizationList/PlanAuthorizationList';
import { Details } from '../../ui/Details';
import { useProjectStore } from '../../stores/projectStore';
import { Button } from '../../ui/Button';
import { ReadingSheet } from '../../ui/ReadingSheet';
import { InlineError } from '../../ui/InlineError';
import { FailureAlert } from '../../patterns/FailureAlert';
import { usePlanReviewStore } from '../../stores/planReviewStore';
import { reopenPlanReview } from '../../services/planReviewService';
import { useElectronApi } from '../../hooks/useElectronApi';
import { useAsyncValue } from '../../lib/useAsyncValue';
import { Skeleton } from '../../ui/Skeleton';
import { usePlanReviewActions } from './usePlanReviewActions';
import { planAppendixMarkdown } from './planPreview';
import type { ConversationPlanReview } from '@shared/types/planReview';
import './plan-review-panel.css';

export const PlanReviewPanel: React.FC<{
  open: boolean;
  onExited: () => void;
  plan: ConversationPlanReview;
  onClose: () => void;
}> = ({ open, onExited, plan, onClose }) => {
  const { t } = useI18n();
  const api = useElectronApi();
  const sessionId = useProjectStore((state) => state.currentSessionId);
  const projection = usePlanReviewStore((state) => (sessionId ? state.bySession[sessionId] : undefined));
  const canReopen =
    projection?.recoverable?.planId === plan.planId && projection.recoverable.revision === plan.revision;
  const { readPlan, copyPlan, saveToProject, exportPlan } = usePlanReviewActions();
  const [actionError, setActionError] = useState<{ reason: unknown } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const initialSession = useRef(sessionId);
  // The panel belongs to the session it opened in; switching away closes it.
  const ownSession = Boolean(sessionId) && initialSession.current === sessionId;
  useEffect(() => {
    if (!ownSession) onClose();
  }, [ownSession, onClose]);
  const planRead = useAsyncValue(
    ownSession ? JSON.stringify([sessionId, plan.planId, plan.revision, plan.uri, plan.hash]) : null,
    () =>
      readPlan({
        sessionId: sessionId!,
        planId: plan.planId,
        revision: plan.revision,
        uri: plan.uri,
        expectedHash: plan.hash,
      }),
  );
  const markdown = planRead.status === 'ready' ? planRead.value.markdown : '';
  const loading = planRead.status === 'loading';
  const failure = actionError ?? (planRead.status === 'error' ? { reason: planRead.error } : null);
  const parts = useMemo(() => splitPlanAppendix(markdown), [markdown]);
  const reference = {
    sessionId: sessionId!,
    planId: plan.planId,
    revision: plan.revision,
    uri: plan.uri,
    expectedHash: plan.hash,
  };

  const runAction = async (action: () => Promise<boolean>, message: string) => {
    if (!sessionId || busy) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      if (await action()) setNotice(message);
    } catch (reason) {
      setActionError({ reason });
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || loading || !markdown || !sessionId;
  return (
    <ReadingSheet
      dataTestId="plan-review-panel"
      title={plan.title}
      meta={t('chat.planReviewRevision', { revision: plan.revision })}
      closeLabel={t('chat.planReviewClose')}
      open={open}
      onClose={onClose}
      onExited={onExited}
      actions={
        <>
          {canReopen ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || loading}
              onClick={() =>
                void runAction(async () => {
                  const restored = await reopenPlanReview(api, reference);
                  usePlanReviewStore.getState().accept(restored);
                  onClose();
                  return true;
                }, t('chat.planReviewReopened'))
              }
            >
              {t('chat.planReviewReopen')}
            </Button>
          ) : null}
          <IconButton
            label={t('chat.planReviewExport')}
            size="sm"
            disabled={disabled}
            onClick={() => void runAction(() => exportPlan(reference), t('chat.planReviewExported'))}
          >
            <Icon name="upload" size={14} />
          </IconButton>
          <IconButton
            label={t('chat.planReviewSave')}
            size="sm"
            disabled={disabled}
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
        </>
      }
      status={
        notice || failure || projection?.error ? (
          <>
            {notice ? (
              <p className="plan-review-panel__notice" role="status">
                {notice}
              </p>
            ) : null}
            {failure ? (
              <FailureAlert reason={failure.reason} contextKey="app.error.actionFailed" />
            ) : projection?.error ? (
              <InlineError detail={projection.error}>{t('app.error.actionFailed')}</InlineError>
            ) : null}
          </>
        ) : undefined
      }
    >
      <div className="plan-review-panel__body" aria-busy={loading}>
        {loading ? (
          <div role="status" aria-label={t('chat.planReviewLoading')}>
            <Skeleton shape="line" count={5} />
          </div>
        ) : markdown ? (
          <>
            <MessageMarkdown content={parts.body} />
            <PlanAuthorizationList authorizations={plan.authorizations ?? []} />
            {parts.appendix ? (
              <Details
                variant="panel"
                className="plan-review-panel__appendix"
                data-testid="plan-review-appendix"
                summary={t('chat.planReviewExecutionReferences')}
              >
                <MessageMarkdown content={planAppendixMarkdown(parts.appendix)} />
              </Details>
            ) : null}
          </>
        ) : null}
      </div>
    </ReadingSheet>
  );
};
