import React, { useMemo } from 'react';
import { useI18n } from '../../i18n';
import { ActiveSignalText } from '../../ui/ActiveSignalText';
import { Chevron } from '../../ui/Chevron';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { ScopedWorkDisclosure, useScopedWorkDisclosure } from './ScopedWorkDisclosure';
import { buildWorkProcessPresentation } from './workProcessTracePresentation';
import { WorkProcessContent } from './WorkProcessContent';
import { planDeliverables } from './planDeliverables';
import { WorkProcessFoldProvider } from './workProcessFold';
import type { ConversationWorkTrace } from '@shared/types/conversation';

interface WorkProcessProps {
  trace: ConversationWorkTrace;
  sessionId?: string | null;
  messageId: string;
  answer?: string;
}

/**
 * Working stays open while the turn runs and when it ends in an error or a stop. Under "follow latest" it folds once
 * the turn completes normally. A plan awaiting review starts with Working folded, so the plan reads below it.
 * Opening or closing Working by hand is remembered for this message and always wins.
 */
const WorkProcessBody: React.FC<WorkProcessProps> = ({ trace, sessionId, answer }) => {
  const { t } = useI18n();
  const presentation = useMemo(() => buildWorkProcessPresentation(trace, t, { reply: answer ?? '' }), [trace, t, answer]);
  const awaitingReview = trace.status === 'running' && planDeliverables(trace).some((plan) => plan.status === 'awaiting');
  const running = trace.status === 'running' && !awaitingReview;
  const showAll = useAppSettingsStore((state) => state.settings.appearance.workProcessExpansion) === 'all';
  const [expanded, toggle] = useScopedWorkDisclosure('root',
    !awaitingReview && (running || showAll || trace.status === 'error' || trace.status === 'stopped'));

  const headlineCopy = trace.status === 'stopped'
    ? t('chat.workProcessHeadlineStopped')
    : running
      ? t('chat.workProcessHeadlineRunning')
      : t('chat.workProcessTitle');
  const actionMeta = presentation.actionCount > 0
    ? t(presentation.actionCount === 1 ? 'chat.workProcessActionOne' : 'chat.workProcessActions', { count: presentation.actionCount })
    : '';
  // While working the clock is the whole label; a settled turn says how long it took.
  const durationMeta = presentation.duration
    ? running ? presentation.duration : t('chat.workProcessDuration', { duration: presentation.duration })
    : '';
  const metaParts = [durationMeta, actionMeta].filter(Boolean);
  const hasBody = Boolean(presentation.summary) || presentation.rows.length > 0;

  return (
    <section
      className={`work-process status-${trace.status} ${expanded ? 'is-expanded' : 'is-collapsed'}`}
      data-testid="work-process"
      aria-label={headlineCopy}
    >
      <button type="button" className="work-process-header" onClick={toggle} aria-expanded={expanded}>
        <span className={`work-process-status-dot status-${trace.status}`} aria-hidden="true" />
        <span className="work-process-heading-copy">
          {running ? (
            <ActiveSignalText active tone="info" className={`work-process-label status-${trace.status}`}>
              {headlineCopy}
            </ActiveSignalText>
          ) : (
            <span className={`work-process-label status-${trace.status}`}>{headlineCopy}</span>
          )}
          {metaParts.length > 0 ? <span className="work-process-meta">{metaParts.join(' · ')}</span> : null}
        </span>
        <Chevron open={expanded} size={12} className="work-process-caret" />
      </button>

      {hasBody ? (
        <WorkProcessFoldProvider value={!expanded}>
          <WorkProcessContent presentation={presentation} sessionId={sessionId} active={running} />
        </WorkProcessFoldProvider>
      ) : null}
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
