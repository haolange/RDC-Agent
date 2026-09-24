import React from 'react';
import type { ConversationToolCall } from '@shared/types/conversation';
import type { DelegationTraceStep } from '@shared/types/delegationTrace';
import type { WorkProcessRow } from './workProcessTypes';
import { getRowStatusLabel } from './workProcessStatus';
import { formatDurationMs } from './workProcessFormat';
import { createToolRowForPresentation } from './workProcessToolRows';
import { ToolRow } from './WorkProcessRowParts';
import { useDelegationTrace } from './useDelegationTrace';
import { useElectronApi } from '../../hooks/useElectronApi';
import { useI18n } from '../../i18n';

type SubagentWorkRow = Extract<WorkProcessRow, { type: 'subagent' }>;

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
  return <details><summary>{step.toolName} · {step.eventId ?? step.id}</summary>
    <pre>{step.args}</pre>
    <pre>{content || step.receipt}</pre>
    {step.receiptRef && offset !== null ? <button type="button" className="work-process-subagent-more"
      onClick={() => { void load(); }}>{content ? t('chat.subagentReceiptMore') : t('chat.subagentLoadReceipt')}</button> : null}
    {error ? <span className="work-process-subagent-receipt-error">{t('chat.subagentReceiptError')}</span> : null}
    {step.receiptTruncated && offset === null ? <span>{t('chat.subagentReceiptTruncated')}</span> : null}
  </details>;
}

function Step({ step, sessionId }: { step: DelegationTraceStep; sessionId?: string | null }) {
  if (step.kind === 'tool') {
    if (step.toolName === 'subagent') {
      let args: { task?: string; profile?: string; mode?: string } = {};
      try { args = JSON.parse(step.args ?? '{}') as typeof args; } catch { /* receipt remains available below */ }
      return <SubagentRow row={{ type: 'subagent', id: step.id, status: step.status, profile: args.profile ?? 'general',
        task: args.task ?? '', mode: args.mode === 'background' ? 'background' : 'wait',
        argsPreview: step.args ?? '', resultPreview: step.receipt ?? '',
        duration: formatDurationMs(step.timestamp, step.completedAt) }} sessionId={sessionId} />;
    }
    const call: ConversationToolCall = {
      id: step.id, toolName: step.toolName ?? 'tool', status: step.status,
      argsPreview: step.args, resultPreview: step.receipt,
      startedAt: step.timestamp, completedAt: step.completedAt,
    };
    const row = createToolRowForPresentation(call);
    return row.type === 'tool' ? <ToolRow key={step.id} row={row} /> : null;
  }
  if (step.kind === 'diagnostic') return <li className={`work-process-child-diagnostic status-${step.status}`}>
    <span className="work-process-child-message">{step.text}</span>
  </li>;
  return <li className={`work-process-child-summary status-${step.status}`}>
    <span className="work-process-child-text">{step.text}</span>
  </li>;
}

export const SubagentRow: React.FC<{ row: SubagentWorkRow; sessionId?: string | null }> = ({ row, sessionId }) => {
  const { t } = useI18n();
  const [expanded, setExpanded] = React.useState(false);
  const [rawOpen, setRawOpen] = React.useState(false);
  const { page, showMore } = useDelegationTrace(sessionId, row.id, expanded);
  const header = page.header;
  const status = header?.status === 'failed' || header?.status === 'cancelled' || header?.status === 'interrupted' || row.status === 'error' ? 'error'
    : header?.status === 'running' ? 'running' : header ? 'complete' : row.status;
  const duration = header ? formatDurationMs(header.startedAt, header.completedAt) : row.duration;
  const task = header?.task || row.task || t('chat.subagentUntitledTask');
  const profile = header?.profile || row.profile;
  return (
    <li className={`work-process-subagent status-${status}${expanded ? ' is-expanded' : ''}`}
      data-work-process-block-id={row.id} data-testid="work-process-subagent">
      <button type="button" className="work-process-subagent-header" onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded} aria-controls={`delegation-${row.id}`}>
        <span className={`work-process-subagent-caret${expanded ? ' is-open' : ''}`} aria-hidden="true">▸</span>
        <span className="work-process-subagent-profile">{t('chat.subagentLabel')} · {profile}</span>
        <span className="work-process-subagent-summary" title={task}>{task}</span>
        <span className={`work-process-subagent-status status-${status}`}>
          {header?.status === 'interrupted' ? t('chat.subagentInterrupted')
            : status === 'complete' ? t('chat.subagentComplete') : getRowStatusLabel(status)}
        </span>
        {duration ? <span className="work-process-subagent-duration">{duration}</span> : null}
      </button>
      {expanded ? (
        <div id={`delegation-${row.id}`} className="work-process-subagent-body">
          <div className="work-process-subagent-boundary">
            <span>{t('chat.subagentTask')}</span><p>{task}</p>
          </div>
          <div className="work-process-subagent-process-label">{t('chat.subagentProcess')}</div>
          {page.error ? <div className="work-process-subagent-receipt-error" role="alert">{t('chat.subagentTraceError')}</div> : null}
          <ol className="work-process-subagent-children">
            {page.steps.map((step) => <Step key={step.id} step={step} sessionId={sessionId} />)}
          </ol>
          {page.nextCursor !== null ? (
            <button type="button" className="work-process-subagent-more" onClick={showMore}>{t('chat.subagentShowMore')}</button>
          ) : null}
          <div className="work-process-subagent-boundary">
            <span>{t('chat.subagentResult')}</span>
            <p>{header?.result || (status === 'running' ? t('chat.subagentStillRunning') : row.resultPreview)}</p>
          </div>
          <button type="button" className="work-process-subagent-raw-toggle" aria-expanded={rawOpen}
            onClick={() => setRawOpen((value) => !value)}>{t('chat.subagentCallReceipt')} {rawOpen ? '▴' : '▾'}</button>
          {rawOpen ? (
            <div className="work-process-subagent-raw">
              <dl><dt>{t('chat.subagentInvocation')}</dt><dd><pre>{header?.invocation ?? row.argsPreview}</pre></dd>
                <dt>{t('chat.subagentReceipt')}</dt><dd><pre>{header?.result ?? row.resultPreview}</pre></dd>
                <dt>{t('chat.subagentExecutionId')}</dt><dd>{header?.executionId ?? row.executionId ?? '—'}</dd>
                <dt>{t('chat.subagentGeneration')}</dt><dd>{header?.generation ?? row.generation ?? '—'}</dd>
                <dt>{t('chat.subagentTaskId')}</dt><dd>{header?.taskId ?? '—'}</dd>
                <dt>{t('chat.subagentChildSession')}</dt><dd>{header?.childSessionId ?? '—'}</dd></dl>
              {page.steps.filter((step) => step.kind === 'tool').map((step) => (
                <ReceiptEntry key={step.id} step={step} sessionId={sessionId} parentToolCallId={row.id} />
              ))}
              {page.steps.filter((step) => step.kind === 'diagnostic').map((step) => (
                <div className="work-process-subagent-receipt-error" key={step.id}>{step.eventId ?? step.id} · {step.text}</div>
              ))}
              {page.nextCursor !== null ? <button type="button" className="work-process-subagent-more"
                onClick={showMore}>{t('chat.subagentShowMore')}</button> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
};
