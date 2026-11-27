import React, { useMemo } from 'react';
import { splitPlanAppendix } from '@shared/utils/planAppendix';
import { useI18n } from '../../i18n';
import { MessageMarkdown } from '../../patterns/Markdown/MessageMarkdown';
import { PlanAuthorizationList } from '../../patterns/PlanAuthorizationList/PlanAuthorizationList';
import { Details } from '../../ui/Details';
import { Skeleton } from '../../ui/Skeleton';
import { useAsyncValue } from '../../lib/useAsyncValue';
import { usePlanReviewActions } from './usePlanReviewActions';
import { planAppendixMarkdown } from './planPreview';
import type { ConversationPlanReview } from '@shared/types/planReview';
import './plan-document.css';

export interface PlanDocument {
  loading: boolean;
  markdown: string;
  parts: ReturnType<typeof splitPlanAppendix>;
  error: unknown;
}

/**
 * The full text of one plan revision, read by main against the revision's URI and hash. `sessionId: null` reads
 * nothing: a reader that has left its session, or a card that is still folded.
 */
export function usePlanDocument(plan: ConversationPlanReview, sessionId: string | null): PlanDocument {
  const { readPlan } = usePlanReviewActions();
  const read = useAsyncValue(
    sessionId ? JSON.stringify([sessionId, plan.planId, plan.revision, plan.uri, plan.hash]) : null,
    () =>
      readPlan({
        sessionId: sessionId!,
        planId: plan.planId,
        revision: plan.revision,
        uri: plan.uri,
        expectedHash: plan.hash,
      }),
  );
  const markdown = read.status === 'ready' ? read.value.markdown : '';
  const parts = useMemo(() => splitPlanAppendix(markdown), [markdown]);
  return {
    loading: read.status === 'loading',
    markdown,
    parts,
    error: read.status === 'error' ? read.error : null,
  };
}

/** The plan as a person reads it: the body, the interventions it authorizes, and the execution appendix folded. */
export const PlanDocumentBody: React.FC<{ plan: ConversationPlanReview; document: PlanDocument }> = ({
  plan,
  document,
}) => {
  const { t } = useI18n();
  return (
    <div className="plan-document" aria-busy={document.loading}>
      {document.loading ? (
        <div role="status" aria-label={t('chat.planReviewLoading')}>
          <Skeleton shape="line" count={5} />
        </div>
      ) : document.markdown ? (
        <>
          <MessageMarkdown content={document.parts.body} />
          <PlanAuthorizationList authorizations={plan.authorizations ?? []} />
          {document.parts.appendix ? (
            <Details
              variant="panel"
              className="plan-document__appendix"
              data-testid="plan-appendix"
              summary={t('chat.planReviewExecutionReferences')}
            >
              <MessageMarkdown content={planAppendixMarkdown(document.parts.appendix)} />
            </Details>
          ) : null}
        </>
      ) : null}
    </div>
  );
};
