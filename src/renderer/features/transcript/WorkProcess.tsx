import React, { useMemo } from 'react';
import { useI18n } from '../../i18n';
import { ActiveSignalText } from '../../ui/ActiveSignalText';
import { Chevron } from '../../ui/Chevron';
import { ScopedWorkDisclosure, useScopedWorkDisclosure } from './ScopedWorkDisclosure';
import { buildWorkProcessPresentation } from './workProcessTracePresentation';
import { WorkProcessContent } from './WorkProcessContent';
import type { ConversationWorkTrace } from '@shared/types/conversation';

interface WorkProcessProps {
  trace: ConversationWorkTrace;
  sessionId?: string | null;
  messageId: string;
}

/**
 * Working stays open while the turn runs and when it ends in an error or a stop, and folds once the turn
 * completes normally. Opening or closing it by hand is remembered for this message and always wins.
 */
const WorkProcessBody: React.FC<WorkProcessProps> = ({ trace, sessionId }) => {
  const { t } = useI18n();
  const presentation = useMemo(() => buildWorkProcessPresentation(trace, t), [trace, t]);
  const running = trace.status === 'running';
  const [expanded, toggle] = useScopedWorkDisclosure('root', running || trace.status === 'error' || trace.status === 'stopped');

  const headlineCopy = trace.status === 'stopped'
    ? t('chat.workProcessHeadlineStopped')
    : running
      ? t('chat.workProcessHeadlineRunning')
      : t('chat.workProcessTitle');
  const actionMeta = presentation.actionCount > 0
    ? t(presentation.actionCount === 1 ? 'chat.workProcessActionOne' : 'chat.workProcessActions', { count: presentation.actionCount })
    : '';
  const durationMeta = presentation.duration
    ? t(running ? 'chat.workProcessDurationRunning' : 'chat.workProcessDuration', { duration: presentation.duration })
    : '';
  const metaParts = [durationMeta, actionMeta].filter(Boolean);
  const hasBody = Boolean(presentation.summary) || presentation.rows.length > 0;

  return (
    <section
      className={`work-process status-${trace.status} ${expanded ? 'is-expanded' : 'is-collapsed'}`}
      data-testid="work-process"
      aria-label={headlineCopy}
    >
      <div className="work-process-header-row">
        <button type="button" className="work-process-header" onClick={toggle} aria-expanded={expanded}>
          <Chevron open={expanded} size={12} className="work-process-caret" />
          <span className={`work-process-status-dot status-${trace.status}`} aria-hidden="true" />
          {running ? (
            <ActiveSignalText active tone="info" className={`work-process-label status-${trace.status}`}>
              {headlineCopy}
            </ActiveSignalText>
          ) : (
            <span className={`work-process-label status-${trace.status}`}>{headlineCopy}</span>
          )}
          {metaParts.length > 0 ? <span className="work-process-meta">{metaParts.join(' · ')}</span> : null}
        </button>
      </div>

      {hasBody ? <WorkProcessContent presentation={presentation} sessionId={sessionId} active={running} /> : null}
    </section>
  );
};

const WorkProcessInner: React.FC<WorkProcessProps> = (props) => (
  <ScopedWorkDisclosure scope={`${props.sessionId ?? ''}\u0000${props.messageId}`}>
    <WorkProcessBody {...props} />
  </ScopedWorkDisclosure>
);

export const WorkProcess = React.memo(WorkProcessInner);

export default WorkProcess;
