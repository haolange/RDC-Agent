import React, { useMemo } from 'react';
import { useI18n } from '../../i18n';
import { withLanguage } from '../../i18n/messages';
import { ActiveSignalText } from '../../ui/ActiveSignalText';
import { Chevron } from '../../ui/Chevron';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { PlainButton } from '../../ui/PlainButton';
import { ScopedWorkDisclosure, useScopedWorkDisclosure } from './ScopedWorkDisclosure';
import { buildWorkProcessPresentation, formatTraceDuration } from './workProcessTracePresentation';
import { useThinkingMarkdownParser } from './workProcessThinkingContent';
import { WorkProcessContent } from './WorkProcessContent';
import { WorkProcessFoldProvider } from './workProcessFold';
import { useWorkClock } from './useWorkClock';
import type { ConversationWorkTrace } from '@shared/types/conversation';
import type { TurnStopCause } from '@shared/types/lifecycle';

interface WorkProcessProps {
  trace: ConversationWorkTrace;
  sessionId?: string | null;
  /** Who stopped a stopped turn: a stop at app shutdown reads differently from the person's Stop. */
  stopCause?: TurnStopCause;
  /** The transcript row's lasting identity (its message id); open and close choices are remembered under it. */
  rowKey: string;
  answer?: string;
}

/** A plan revision is waiting for the person's decision; replaced revisions carry their own status. */
const awaitsPlanReview = (trace: ConversationWorkTrace): boolean =>
  trace.blocks.some((block) => block.toolCalls.some((call) => call.planReview?.status === 'awaiting'));

/**
 * Working stays open while the turn runs, including while its plan card waits for review, when it ends in an error or
 * a stop, and while any of its actions failed. Under "follow latest" it folds once the turn completes cleanly. Opening or closing Working by
 * hand is remembered for this transcript row, from the send through main's answer and across windowed remounts, and always wins.
 */
const WorkProcessBody: React.FC<WorkProcessProps> = ({ trace, sessionId, answer, stopCause }) => {
  const { t, language } = useI18n();
  const localized = useMemo(() => withLanguage(t, language), [t, language]);
  // Thinking rows are re-judged once the Markdown parser arrives.
  const thinkingParser = useThinkingMarkdownParser();
  const presentation = useMemo(
    () => buildWorkProcessPresentation(trace, localized, { reply: answer ?? '' }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- thinkingParser changes what the build reads
    [trace, localized, answer, thinkingParser],
  );
  const inProgress = trace.status === 'running';
  // Waiting on the person is not work: the header stops its signal, but the window keeps following the plan card.
  const running = inProgress && !awaitsPlanReview(trace);
  const showAll = useAppSettingsStore((state) => state.settings.appearance.workProcessExpansion) === 'all';
  const [expanded, toggle] = useScopedWorkDisclosure(
    'root',
    inProgress || showAll || trace.status === 'error' || trace.status === 'stopped' || presentation.failureCount > 0,
  );

  const headlineCopy =
    trace.status === 'stopped'
      ? t(
          stopCause === 'app-shutdown'
            ? 'chat.workProcessHeadlineStoppedAtShutdown'
            : 'chat.workProcessHeadlineStopped',
        )
      : running
        ? t('chat.workProcessHeadlineRunning')
        : t('chat.workProcessTitle');
  const actionMeta =
    presentation.actionCount > 0
      ? t(presentation.actionCount === 1 ? 'chat.workProcessActionOne' : 'chat.workProcessActions', {
          count: presentation.actionCount,
        })
      : '';
  // While working the clock is the whole label and advances on the shared second; a settled turn says how long it took.
  const now = useWorkClock(running);
  const duration = formatTraceDuration(trace.blocks, language, now);
  const durationMeta = duration ? (running ? duration : t('chat.workProcessDuration', { duration })) : '';
  const metaParts = [durationMeta, actionMeta].filter(Boolean);
  const failureMeta =
    presentation.failureCount > 0 ? t('chat.workProcessFailures', { count: presentation.failureCount }) : '';
  const hasBody = Boolean(presentation.summary) || presentation.rows.length > 0;
  // A settled turn with nothing to show leaves no Working behind.
  if (!inProgress && !hasBody) return null;
  // While the turn runs with nothing to show yet, the header alone says it is working and for how long.
  if (!hasBody) {
    return (
      <section className={`work-process status-${trace.status} is-collapsed`} data-testid="work-process">
        <div className="work-process-header is-static" role="status">
          <span className={`work-process-status-dot status-${trace.status}`} aria-hidden="true" />
          <span className="work-process-heading-copy">
            <ActiveSignalText active={running} tone="info" className={`work-process-label status-${trace.status}`}>
              {headlineCopy}
            </ActiveSignalText>
            {/* The clock starts with the first block; before it there is no start time to count from. */}
            {trace.blocks.length > 0 && durationMeta ? <span className="work-process-meta">{durationMeta}</span> : null}
          </span>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`work-process status-${trace.status} ${expanded ? 'is-expanded' : 'is-collapsed'}`}
      data-testid="work-process"
      aria-label={headlineCopy}
    >
      <PlainButton className="work-process-header" onClick={toggle} aria-expanded={expanded}>
        <span className={`work-process-status-dot status-${trace.status}`} aria-hidden="true" />
        <span className="work-process-heading-copy">
          {running ? (
            <ActiveSignalText active tone="info" className={`work-process-label status-${trace.status}`}>
              {headlineCopy}
            </ActiveSignalText>
          ) : (
            <span className={`work-process-label status-${trace.status}`}>{headlineCopy}</span>
          )}
          {metaParts.length > 0 || failureMeta ? (
            <span className="work-process-meta">
              {metaParts.join(' · ')}
              {failureMeta ? (
                <>
                  {metaParts.length > 0 ? ' · ' : ''}
                  <span className="work-process-meta-failures">{failureMeta}</span>
                </>
              ) : null}
            </span>
          ) : null}
        </span>
        <Chevron open={expanded} size={12} className="work-process-caret" />
      </PlainButton>

      <WorkProcessFoldProvider value={!expanded}>
        <WorkProcessContent presentation={presentation} sessionId={sessionId} active={inProgress} />
      </WorkProcessFoldProvider>
    </section>
  );
};

const WorkProcessInner: React.FC<WorkProcessProps> = (props) => (
  <ScopedWorkDisclosure scope={props.rowKey}>
    <WorkProcessBody {...props} />
  </ScopedWorkDisclosure>
);

export const WorkProcess = React.memo(WorkProcessInner);

export default WorkProcess;
