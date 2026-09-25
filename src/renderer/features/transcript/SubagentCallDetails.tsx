import React from 'react';
import type { DelegationContentKind, DelegationTraceHeader } from '@shared/types/delegationTrace';
import { useI18n } from '../../i18n';
import { useDelegationContent } from './useDelegationContent';
import { Button } from '../../ui/Button';
import { useClipboardBridge } from '../../hooks/useClipboardBridge';
import { useScopedWorkDisclosure } from './ScopedWorkDisclosure';
import { WorkDisclosure } from './WorkDisclosure';
import { formatInvocation } from './subagentPresentation';

function Detail({ label, kind, available, sessionId, parentToolCallId, childSessionId, executionId, generation }: {
  label: string; kind: DelegationContentKind; available: boolean;
  sessionId?: string | null; parentToolCallId: string; childSessionId?: string; executionId?: string; generation?: number;
}) {
  const { t } = useI18n();
  const [open, toggle] = useScopedWorkDisclosure(kind, false);
  const content = useDelegationContent({ sessionId, parentToolCallId, childSessionId, executionId, generation, kind, open, available });
  return <WorkDisclosure variant="secondary-card" title={label} open={open} onToggle={toggle}
    disabled={!available} preview={!available ? t('chat.subagentRecordUnavailable') : undefined}>
    <div className="work-process-subagent-record-body">
      {content.text ? <pre className="work-process-tool-card-raw-pre is-unbounded">{kind === 'invocation' ? formatInvocation(content.text) : content.text}</pre> : null}
      {content.loading ? <span>{t('chat.subagentLoading')}</span> : null}
      {content.error ? <button type="button" className="work-process-subagent-more" onClick={content.retry}>{t('chat.subagentRetry')}</button> : null}
      {content.hasMore ? <button type="button" className="work-process-subagent-more" onClick={() => void content.loadMore()}>{t('chat.subagentShowMore')}</button> : null}
    </div>
  </WorkDisclosure>;
}

export const SubagentCallDetails: React.FC<{
  header: DelegationTraceHeader | null;
  sessionId?: string | null;
  parentToolCallId: string;
  executionId?: string;
  generation?: number;
}> = ({ header, sessionId, parentToolCallId, executionId, generation }) => {
  const { t } = useI18n();
  const [identifiersOpen, toggleIdentifiers] = useScopedWorkDisclosure('identifiers', false);
  const { copyText } = useClipboardBridge();
  const identifiers = [
    [t('chat.subagentExecutionId'), header?.executionId ?? executionId],
    [t('chat.subagentGeneration'), header?.generation ?? generation],
    [t('chat.subagentTaskId'), header?.taskId],
    [t('chat.subagentChildSession'), header?.childSessionId],
  ].filter((item): item is [string, string | number] => item[1] !== undefined && item[1] !== '');
  return <div className="work-process-subagent-raw" data-testid="work-process-subagent-details">
    <Detail label={t('chat.subagentInvocation')} kind="invocation" available={!!header?.invocationAvailable}
      sessionId={sessionId} parentToolCallId={parentToolCallId} childSessionId={header?.childSessionId}
      executionId={header?.executionId} generation={header?.generation} />
    <Detail label={t('chat.subagentReceipt')} kind="parent_receipt" available={!!header?.parentReceiptAvailable}
      sessionId={sessionId} parentToolCallId={parentToolCallId} childSessionId={header?.childSessionId}
      executionId={header?.executionId} generation={header?.generation} />
    <Detail label={t('chat.subagentSentPrompt')} kind="sent_prompt" available={!!header?.sentPromptAvailable}
      sessionId={sessionId} parentToolCallId={parentToolCallId} childSessionId={header?.childSessionId}
      executionId={header?.executionId} generation={header?.generation} />
    {identifiers.length > 0 ? <WorkDisclosure variant="secondary-card" title={t('chat.subagentIdentifiers')}
      open={identifiersOpen} onToggle={toggleIdentifiers}><dl className="work-process-subagent-identifiers">
      {identifiers.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={String(value)}>{value}<Button variant="ghost" size="sm" onClick={() => void copyText(String(value))}>{t('chat.subagentCopy')}</Button></dd></div>)}
    </dl></WorkDisclosure> : null}
    {header?.error ? <p className="work-process-subagent-receipt-error" role="alert">{header.error}</p> : null}
  </div>;
};
