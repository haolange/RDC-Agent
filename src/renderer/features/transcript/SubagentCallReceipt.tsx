import React from 'react';
import type { DelegationTracePage, DelegationTraceStep } from '@shared/types/delegationTrace';
import { useElectronApi } from '../../hooks/useElectronApi';
import { useI18n } from '../../i18n';
import { formatInvocation } from './subagentPresentation';

function ReceiptEntry({ step, sessionId, parentToolCallId }: {
  step: DelegationTraceStep; sessionId?: string | null; parentToolCallId: string;
}) {
  const api = useElectronApi();
  const { t } = useI18n();
  const [content, setContent] = React.useState('');
  const [offset, setOffset] = React.useState<number | null>(0);
  const [error, setError] = React.useState(false);
  const load = async () => {
    if (!sessionId || !api || !step.receiptRef || offset === null) return;
    try {
      const page = await api.conversation.getDelegationReceipt({ sessionId, parentToolCallId, stepId: step.id, offset });
      setContent((previous) => previous + page.text);
      setOffset(page.nextOffset);
      setError(false);
    } catch { setError(true); }
  };
  return (
    <details className="work-process-subagent-record">
      <summary><span>{step.toolName || t('chat.subagentReceipt')}</span><span className="work-process-subagent-record-id">{step.eventId ?? step.id}</span></summary>
      <div className="work-process-subagent-record-body">
        {step.args ? <div><span className="work-process-subagent-record-label">{t('chat.subagentInvocation')}</span><pre>{formatInvocation(step.args)}</pre></div> : null}
        {content || step.receipt ? <div><span className="work-process-subagent-record-label">{t('chat.subagentReceipt')}</span><pre>{content || step.receipt}</pre></div> : null}
        {step.receiptRef && offset !== null ? <button type="button" className="work-process-subagent-more"
          onClick={() => { void load(); }}>{content ? t('chat.subagentReceiptMore') : t('chat.subagentLoadReceipt')}</button> : null}
        {error ? <span className="work-process-subagent-receipt-error">{t('chat.subagentReceiptError')}</span> : null}
        {step.receiptTruncated && offset === null ? <span>{t('chat.subagentReceiptTruncated')}</span> : null}
      </div>
    </details>
  );
}

export const SubagentCallReceipt: React.FC<{
  page: DelegationTracePage;
  invocation: string;
  result: string;
  sessionId?: string | null;
  parentToolCallId: string;
  executionId?: string;
  generation?: number;
}> = ({ page, invocation, result, sessionId, parentToolCallId, executionId, generation }) => {
  const { t } = useI18n();
  const header = page.header;
  const identifiers = [
    [t('chat.subagentExecutionId'), header?.executionId ?? executionId],
    [t('chat.subagentGeneration'), header?.generation ?? generation],
    [t('chat.subagentTaskId'), header?.taskId],
    [t('chat.subagentChildSession'), header?.childSessionId],
  ].filter((item): item is [string, string | number] => item[1] !== undefined && item[1] !== '');
  return (
    <div className="work-process-subagent-raw" data-testid="work-process-subagent-raw">
      {identifiers.length > 0 ? <dl className="work-process-subagent-identifiers">
        {identifiers.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={String(value)}>{value}</dd></div>)}
      </dl> : null}
      {invocation ? <details className="work-process-subagent-record"><summary>{t('chat.subagentInvocation')}</summary>
        <div className="work-process-subagent-record-body"><pre>{formatInvocation(invocation)}</pre></div>
      </details> : null}
      {result ? <details className="work-process-subagent-record"><summary>{t('chat.subagentReceipt')}</summary>
        <div className="work-process-subagent-record-body"><pre>{result}</pre></div>
      </details> : null}
      {page.steps.filter((step) => step.kind === 'tool').map((step) => <ReceiptEntry key={step.id} step={step}
        sessionId={sessionId} parentToolCallId={parentToolCallId} />)}
      {page.steps.filter((step) => step.kind === 'diagnostic').map((step) => (
        <div className="work-process-subagent-receipt-error" key={step.id}>{step.eventId ?? step.id} · {step.text}</div>
      ))}
    </div>
  );
};
