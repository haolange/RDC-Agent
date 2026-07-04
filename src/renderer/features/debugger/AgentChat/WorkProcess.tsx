import React, { useEffect, useMemo, useState } from 'react';
import type { ConversationWorkTrace } from '@shared/types/conversation';
import { useI18n } from '../../../i18n';
import {
  buildWorkProcessPresentation,
  type WorkProcessRow,
} from './workProcessPresentation';
import { SubagentRow } from './SubagentRow';
import { TaskRow } from './TaskRow';
import {
  ApprovalRow,
  DiagnosticRow,
  SummaryRow,
  ToolGroupRow,
  ToolRow,
  UserInputRow,
} from './WorkProcessRows';
import { ResponseRow } from './WorkProcessResponseRow';
import { WorkProcessRailIcon } from './WorkProcessRailIcon';

interface WorkProcessProps {
  trace: ConversationWorkTrace;
}

const SectionRow: React.FC<{ row: Extract<WorkProcessRow, { type: 'section' }> }> = ({ row }) => {
  const hasError = row.status === 'error' || row.steps.some((step) => step.status === 'error');
  const showSteps = row.stepCount > 0;
  const resultClassName = [
    'work-process-loop-result',
    row.resultStreaming ? 'is-streaming' : '',
    row.clampResult ? 'is-clamped' : '',
  ].filter(Boolean).join(' ');
  const hasResult = Boolean(row.resultText || row.resultToolSummary);
  const thinkingClassName = [
    'work-process-thinking-state',
    row.thinkingKind ? `kind-${row.thinkingKind}` : '',
    row.thinkingVisibility ? `visibility-${row.thinkingVisibility}` : '',
    row.thinkingStatus ? `status-${row.thinkingStatus}` : '',
  ].filter(Boolean).join(' ');

  return (
    <li className={`work-process-step work-process-section status-${row.status} kind-section`} data-testid="work-process-section">
      <WorkProcessRailIcon variant="section" status={row.status} />
      <div className="work-process-step-content">
        {row.thinkingExpandable ? (
          <details className={thinkingClassName} open={row.thinkingOpenByDefault}>
            <summary className="work-process-thinking-summary">
              <span>{row.thinkingLabel}</span>
              {row.thinkingSource ? <span className="work-process-thinking-source">{row.thinkingSource}</span> : null}
              <span className="work-process-row-caret" aria-hidden="true" />
            </summary>
            <pre className="work-process-thinking-preview">{row.thinkingPreview}</pre>
          </details>
        ) : row.thinkingLabel ? (
          <p className={thinkingClassName}>
            <span>{row.thinkingLabel}</span>
            {row.thinkingSource ? <span className="work-process-thinking-source">{row.thinkingSource}</span> : null}
          </p>
        ) : null}
        {hasResult ? (
          <div className={resultClassName}>
            {row.resultText ? <p className="work-process-loop-result-text">{row.resultText}</p> : null}
            {row.resultToolSummary ? <p className="work-process-loop-tool-summary">{row.resultToolSummary}</p> : null}
          </div>
        ) : null}
        {showSteps ? (
          <ol className={`work-process-steps work-process-section-list ${hasError || row.defaultOpen ? 'is-open' : ''}`}>
            {row.steps.map((step) => renderRow(step))}
          </ol>
        ) : null}
      </div>
    </li>
  );
};

const renderRow = (row: WorkProcessRow): React.ReactNode => {
  if (row.type === 'toolGroup') return <ToolGroupRow key={row.id} row={row} renderRow={renderRow} />;
  if (row.type === 'tool') return <ToolRow key={row.id} row={row} />;
  if (row.type === 'userInput') return <UserInputRow key={row.id} row={row} />;
  if (row.type === 'approval') return <ApprovalRow key={row.id} row={row} />;
  if (row.type === 'diagnostic') return <DiagnosticRow key={row.id} row={row} />;
  if (row.type === 'subagent') return <SubagentRow key={row.id} row={row} />;
  if (row.type === 'task') return <TaskRow key={row.id} row={row} />;
  if (row.type === 'response') return <ResponseRow key={row.id} row={row} />;
  if (row.type === 'section') return <SectionRow key={row.id} row={row} />;
  return <SummaryRow key={row.id} row={row} />;
};

export const WorkProcess: React.FC<WorkProcessProps> = ({ trace }) => {
  const { t } = useI18n();
  const presentation = useMemo(() => buildWorkProcessPresentation(trace), [trace]);
  const [expanded, setExpanded] = useState<boolean>(presentation.defaultExpanded);

  useEffect(() => {
    if (trace.status === 'running' || presentation.important) {
      setExpanded(true);
    }
  }, [trace.status, presentation.important]);

  const headlineCopy = t('chat.workProcessTitle');
  const actionMeta = presentation.actionCount > 0
    ? t('chat.workProcessActions', { count: presentation.actionCount })
    : '';
  const durationMeta = presentation.duration ? t('chat.workProcessDuration', { duration: presentation.duration }) : '';
  const metaParts = [durationMeta, actionMeta].filter(Boolean);
  const hasBody = Boolean(presentation.summary) || presentation.rows.length > 0;

  return (
    <section
      className={`work-process status-${trace.status} ${expanded ? 'is-expanded' : 'is-collapsed'}`}
      data-testid="work-process"
      aria-label={headlineCopy}
    >
      <button
        type="button"
        className="work-process-header"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <span className={`work-process-caret ${expanded ? 'is-open' : ''}`} aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </span>
        <span className={`work-process-status-dot status-${trace.status}`} aria-hidden="true" />
        <span className={`work-process-label status-${trace.status}`}>{headlineCopy}</span>
        {metaParts.length > 0 ? <span className="work-process-meta">{metaParts.join(' · ')}</span> : null}
      </button>

      {expanded && hasBody ? (
        <div className="work-process-body">
          {presentation.summary ? (
            <p className="work-process-summary">{presentation.summary}</p>
          ) : null}
          {presentation.rows.length > 0 ? (
            <ol className="work-process-steps">
              {presentation.rows.map((row) => renderRow(row))}
            </ol>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};

export default WorkProcess;
