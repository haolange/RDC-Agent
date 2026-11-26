import React from 'react';
import { useI18n } from '../../i18n';
import { Skeleton } from '../../ui/Skeleton';
import { PlainButton } from '../../ui/PlainButton';
import { WorkDisclosure } from './WorkDisclosure';
import { useScopedWorkDisclosure } from './ScopedWorkDisclosure';
import { useDelegationContent } from './useDelegationContent';

export const DelegatedToolReceipt: React.FC<{
  sessionId?: string | null;
  parentToolCallId: string;
  toolCallId: string;
  childSessionId?: string;
  executionId?: string;
  generation?: number;
}> = ({ sessionId, parentToolCallId, toolCallId, childSessionId, executionId, generation }) => {
  const { t } = useI18n();
  const [open, toggle] = useScopedWorkDisclosure(`receipt-${toolCallId}`, false);
  const content = useDelegationContent({
    sessionId,
    parentToolCallId,
    kind: 'tool_receipt',
    childSessionId,
    executionId,
    generation,
    stepId: toolCallId,
    open,
    available: true,
  });
  return (
    <WorkDisclosure variant="inline" title={t('chat.subagentToolReceipt')} open={open} onToggle={toggle}>
      <div className="work-process-subagent-record-body">
        {content.text ? <pre>{content.text}</pre> : null}
        {content.loading ? (
          <span role="status" aria-label={t('chat.subagentLoading')}>
            <Skeleton shape="line" count={2} inline />
          </span>
        ) : null}
        {content.error ? (
          <PlainButton className="work-process-subagent-more" onClick={content.retry}>
            {t('chat.subagentRetry')}
          </PlainButton>
        ) : null}
        {content.hasMore ? (
          <PlainButton className="work-process-subagent-more" onClick={() => void content.loadMore()}>
            {t('chat.subagentShowMore')}
          </PlainButton>
        ) : null}
      </div>
    </WorkDisclosure>
  );
};
