import React, { useEffect, useMemo, useState } from 'react';
import type { ConversationWorkTrace } from '@shared/types/conversation';
import { useI18n, type TranslationKey } from '../../../i18n';
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
  ToolRow,
  UserInputRow,
} from './WorkProcessRows';
import { WorkProcessRailIcon } from './WorkProcessRailIcon';

interface WorkProcessProps {
  trace: ConversationWorkTrace;
}

const TRACE_HEADLINE_KEY: Record<ConversationWorkTrace['status'], TranslationKey> = {
  idle: 'chat.workProcessHeadlineIdle',
  running: 'chat.workProcessHeadlineRunning',
  complete: 'chat.workProcessHeadlineComplete',
  error: 'chat.workProcessHeadlineError',
  stopped: 'chat.workProcessHeadlineStopped',
};

const StepsEyeIcon: React.FC = () => (
  <svg className="work-process-steps-eye" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const SectionRow: React.FC<{ row: Extract<WorkProcessRow, { type: 'section' }> }> = ({ row }) => {
  const { t } = useI18n();
  const hasAttention = row.steps.some((step) => step.status === 'error' || step.status === 'running');
  const showSteps = row.stepCount > 0;
  const primaryClassName = [
    'work-process-segment-primary',
    row.primaryMode === 'thinking-summary' || row.primaryMode === 'thinking-full' ? 'is-thinking' : '',
    row.primaryMode === 'result' ? 'is-result' : '',
    row.clampPrimary ? 'is-clamped' : '',
    row.primaryMode === 'thinking-full' ? 'is-thinking-full' : '',
  ].filter(Boolean).join(' ');

  return (
    <li className={`work-process-step work-process-section status-${row.status} kind-section`} data-testid="work-process-section">
      <WorkProcessRailIcon variant="section" status={row.status} />
      <div className="work-process-step-content">
        {row.primaryText ? (
          <p className={primaryClassName}>{row.primaryText}</p>
        ) : null}
        {showSteps ? (
          <details className="work-process-section-steps" open={row.defaultOpen || hasAttention}>
            <summary className="work-process-steps-toggle">
              <StepsEyeIcon />
              <span className="work-process-steps-toggle-label">
                {t('chat.workProcessViewSteps', { count: row.stepCount })}
              </span>
              <span className="work-process-steps-chevron" aria-hidden="true" />
            </summary>
            <ol className="work-process-steps work-process-section-list">
              {row.steps.map((step) => renderRow(step))}
            </ol>
          </details>
        ) : null}
      </div>
    </li>
  );
};

const renderRow = (row: WorkProcessRow): React.ReactNode => {
  if (row.type === 'tool') return <ToolRow key={row.id} row={row} />;
  if (row.type === 'userInput') return <UserInputRow key={row.id} row={row} />;
  if (row.type === 'approval') return <ApprovalRow key={row.id} row={row} />;
  if (row.type === 'diagnostic') return <DiagnosticRow key={row.id} row={row} />;
  if (row.type === 'subagent') return <SubagentRow key={row.id} row={row} />;
  if (row.type === 'task') return <TaskRow key={row.id} row={row} />;
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

  const headlineCopy = t(TRACE_HEADLINE_KEY[trace.status]);
  const toolMeta = presentation.toolCount > 0
    ? t('chat.workProcessTools', { count: presentation.toolCount })
    : '';

  return (
    <section
      className={`work-process status-${trace.status} ${expanded ? 'is-expanded' : 'is-collapsed'}`}
      data-testid="work-process"
      aria-label="Work Process"
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
        {toolMeta ? <span className="work-process-meta">{toolMeta}</span> : null}
      </button>

      {expanded ? (
        <div className="work-process-body">
          {presentation.summary ? (
            <p className="work-process-summary">{presentation.summary}</p>
          ) : null}
          {presentation.rows.length === 0 ? (
            <p className="work-process-empty">{t('chat.workProcessEmpty')}</p>
          ) : (
            <ol className="work-process-steps">
              {presentation.rows.map((row) => renderRow(row))}
            </ol>
          )}
        </div>
      ) : null}
    </section>
  );
};

export default WorkProcess;
