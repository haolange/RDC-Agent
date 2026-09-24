import React from 'react';
import type { ConversationToolCall } from '@shared/types/conversation';
import type { DelegationTraceStep } from '@shared/types/delegationTrace';
import type { WorkProcessRow } from './workProcessTypes';
import { getRowStatusLabel } from './workProcessStatus';
import { formatDurationMs } from './workProcessFormat';
import { createToolRowForPresentation } from './workProcessToolRows';
import { ToolRow } from './WorkProcessRowParts';
import { WorkProcessIcon } from './WorkProcessIcons';
import { SubagentCallReceipt } from './SubagentCallReceipt';
import { summarizeDelegationTask } from './subagentPresentation';
import { useDelegationTrace } from './useDelegationTrace';
import { useI18n } from '../../i18n';

type SubagentWorkRow = Extract<WorkProcessRow, { type: 'subagent' }>;

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
  const status = header?.status ?? (row.status === 'error' ? 'failed' : row.status === 'complete' ? 'complete' : 'running');
  const duration = header ? formatDurationMs(header.startedAt, header.completedAt) : row.duration;
  const task = header?.task || row.task || t('chat.subagentUntitledTask');
  const title = summarizeDelegationTask(task);
  const profile = header?.profile || row.profile;
  const result = header?.result || (status === 'running' ? '' : row.resultPreview);
  return (
    <li className={`work-process-subagent is-${status}${expanded ? ' is-expanded' : ''}`}
      data-work-process-block-id={row.id} data-testid="work-process-subagent">
      <button type="button" className="work-process-subagent-header" onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded} aria-controls={`delegation-${row.id}`}>
        <WorkProcessIcon icon="brain" className="work-process-subagent-icon" />
        <span className="work-process-subagent-summary" title={task}>{title}</span>
        <span className="work-process-subagent-profile">{profile}</span>
        <span className={`work-process-subagent-status is-${status}`}>
          {header?.status === 'interrupted' ? t('chat.subagentInterrupted')
            : header?.status === 'cancelled' ? t('chat.subagentCancelled')
              : status === 'complete' ? t('chat.subagentComplete')
                : status === 'failed' ? t('chat.subagentFailed') : getRowStatusLabel('running')}
        </span>
        {duration ? <span className="work-process-subagent-duration">{duration}</span> : null}
        <span className={`work-process-subagent-caret${expanded ? ' is-open' : ''}`} aria-hidden="true" />
      </button>
      {expanded ? (
        <div id={`delegation-${row.id}`} className="work-process-subagent-body">
          <div className="work-process-subagent-boundary">
            <span>{t('chat.subagentTask')}</span><p>{task}</p>
          </div>
          {page.error ? <div className="work-process-subagent-receipt-error" role="alert">{t('chat.subagentTraceError')}</div> : null}
          {page.steps.length > 0 ? <div className="work-process-subagent-process">
            <span className="work-process-subagent-process-label">{t('chat.subagentProcess')}</span>
            <ol className="work-process-subagent-children">
              {page.steps.map((step) => <Step key={step.id} step={step} sessionId={sessionId} />)}
            </ol>
          </div> : null}
          {page.nextCursor !== null ? (
            <button type="button" className="work-process-subagent-more" onClick={showMore}>{t('chat.subagentShowMore')}</button>
          ) : null}
          <div className="work-process-subagent-boundary">
            <span>{t('chat.subagentResult')}</span>
            <p className={`work-process-subagent-result is-${status}`}>{result || (status === 'running' ? t('chat.subagentStillRunning') : '—')}</p>
          </div>
          <button type="button" className="work-process-subagent-raw-toggle" aria-expanded={rawOpen}
            onClick={() => setRawOpen((value) => !value)}>{t('chat.subagentCallReceipt')}
            <span className={`work-process-subagent-caret${rawOpen ? ' is-open' : ''}`} aria-hidden="true" /></button>
          {rawOpen ? <SubagentCallReceipt page={page} invocation={header?.invocation ?? row.argsPreview}
            result={header?.result ?? row.resultPreview} sessionId={sessionId} parentToolCallId={row.id}
            executionId={row.executionId} generation={row.generation} /> : null}
        </div>
      ) : null}
    </li>
  );
};
