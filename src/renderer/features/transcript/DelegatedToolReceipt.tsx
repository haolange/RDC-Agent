import React from 'react';
import { WorkDisclosure } from './WorkDisclosure';
import { useScopedWorkDisclosure } from './ScopedWorkDisclosure';
import { useI18n } from '../../i18n';
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
  const content = useDelegationContent({ sessionId, parentToolCallId, kind: 'tool_receipt',
    childSessionId, executionId, generation, stepId: toolCallId, open, available: true });
  return <WorkDisclosure variant="inline" title={t('chat.subagentToolReceipt')} open={open} onToggle={toggle}>
    <div className="work-process-subagent-record-body">
      {content.text ? <pre>{content.text}</pre> : null}
      {content.loading ? <span>{t('chat.subagentLoading')}</span> : null}
      {content.error ? <button type="button" className="work-process-subagent-more" onClick={content.retry}>{t('chat.subagentRetry')}</button> : null}
      {content.hasMore ? <button type="button" className="work-process-subagent-more" onClick={() => void content.loadMore()}>{t('chat.subagentShowMore')}</button> : null}
    </div>
  </WorkDisclosure>;
};
