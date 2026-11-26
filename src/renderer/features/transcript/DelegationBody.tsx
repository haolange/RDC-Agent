import React from 'react';
import { MessageMarkdown } from '../../patterns/Markdown/MessageMarkdown';
import { useI18n } from '../../i18n';
import { Skeleton } from '../../ui/Skeleton';
import { DelegationTaskDocument } from './DelegationTaskDocument';
import { useDelegationContent } from './useDelegationContent';

/** A delegation's task capsule or final reply, read page by page from the child session. */
export function DelegationBody({
  sessionId,
  parentToolCallId,
  childSessionId,
  executionId,
  generation,
  kind,
  open,
  available,
  taskDisclosure,
}: {
  sessionId?: string | null;
  parentToolCallId: string;
  childSessionId?: string;
  executionId?: string;
  generation?: number;
  kind: 'task' | 'final';
  open: boolean;
  available: boolean;
  taskDisclosure?: Pick<
    React.ComponentProps<typeof DelegationTaskDocument>,
    'factsOpen' | 'constraintsOpen' | 'toggle'
  >;
}) {
  const { t } = useI18n();
  const content = useDelegationContent({
    sessionId,
    parentToolCallId,
    kind,
    open,
    available,
    childSessionId,
    executionId,
    generation,
  });
  return (
    <>
      {content.text ? (
        kind === 'task' ? (
          !content.hasMore && taskDisclosure && <DelegationTaskDocument text={content.text} {...taskDisclosure} />
        ) : (
          <div className="work-process-subagent-final">
            <MessageMarkdown content={content.text} deferHeavyPlugins={content.hasMore} />
          </div>
        )
      ) : null}
      {content.loading ? (
        <span role="status" aria-label={t('chat.subagentLoading')}>
          <Skeleton shape="line" count={2} inline />
        </span>
      ) : null}
      {content.error ? (
        <button type="button" className="work-process-subagent-more" onClick={content.retry}>
          {t('chat.subagentRetry')}
        </button>
      ) : null}
      {content.hasMore ? (
        <button type="button" className="work-process-subagent-more" onClick={() => void content.loadMore()}>
          {t('chat.subagentShowMore')}
        </button>
      ) : null}
    </>
  );
}
