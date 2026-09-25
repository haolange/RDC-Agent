import React from 'react';
import type { ConversationWorkTrace } from '@shared/types/conversation';
import type { WorkProcessRow } from './workProcessTypes';
import { getToolVerb } from './workProcessToolRows';
import { useWorkProcessLabel } from './workProcessUseLabel';
import { ScopedWorkDisclosure } from './ScopedWorkDisclosure';
import { getRowStatusLabel } from './workProcessStatus';
import { formatDurationMs } from './workProcessFormat';
import { ModeGlyph } from '../../ui/ModeGlyph';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { getAgentModeConfig } from '@shared/constants/agents';
import type { AgentMode } from '@shared/types/layout';
import { WorkProcessContent } from './WorkProcessContent';
import { buildWorkProcessPresentation } from './workProcessTracePresentation';
import { SubagentCallDetails } from './SubagentCallDetails';
import { DelegatedToolReceipt } from './DelegatedToolReceipt';
import { DelegationTaskDocument } from './DelegationTaskDocument';
import { useDelegationTrace } from './useDelegationTrace';
import { useDelegationContent } from './useDelegationContent';
import { useSubagentDisclosure } from './useSubagentDisclosure';
import { MessageMarkdown } from '../../patterns/Markdown/MessageMarkdown';
import { WorkCardHeader } from './WorkCardHeader';
import { SubagentProgressDots } from './SubagentProgressDots';
import { WorkDisclosure, FadingPreview } from './WorkDisclosure';
import { useI18n } from '../../i18n';

type SubagentWorkRow = Extract<WorkProcessRow, { type: 'subagent' }>;

function DelegationBody({ sessionId, parentToolCallId, childSessionId, executionId, generation, kind, open, available, taskDisclosure }: {
  sessionId?: string | null; parentToolCallId: string; childSessionId?: string;
  executionId?: string; generation?: number; kind: 'task' | 'final'; open: boolean; available: boolean;
  taskDisclosure?: Pick<React.ComponentProps<typeof DelegationTaskDocument>, 'factsOpen' | 'constraintsOpen' | 'toggle'>;
}) {
  const { t } = useI18n();
  const content = useDelegationContent({ sessionId, parentToolCallId, kind, open, available,
    childSessionId, executionId, generation });
  return <>
    {content.text ? kind === 'task'
      ? !content.hasMore && taskDisclosure && <DelegationTaskDocument text={content.text} {...taskDisclosure} />
      : <div className="work-process-subagent-final"><MessageMarkdown content={content.text} deferHeavyPlugins={content.hasMore} /></div> : null}
    {content.loading ? <span className="work-process-subagent-note">{t('chat.subagentLoading')}</span> : null}
    {content.error ? <button type="button" className="work-process-subagent-more" onClick={content.retry}>{t('chat.subagentRetry')}</button> : null}
    {content.hasMore ? <button type="button" className="work-process-subagent-more" onClick={() => void content.loadMore()}>{t('chat.subagentShowMore')}</button> : null}
  </>;
}

export const SubagentRow: React.FC<{ row: SubagentWorkRow; sessionId?: string | null }> = ({ row, sessionId }) => {
  const { t } = useI18n();
  const label = useWorkProcessLabel();
  const { expanded, workOpen, finalOpen, detailsOpen, factsOpen, constraintsOpen, toggle, openCard } = useSubagentDisclosure(sessionId, row.id);
  const contentId = React.useId();
  const cardRef = React.useRef<HTMLLIElement>(null);
  const { page, loading, headerLoading, hasEarlier, loadEarlier, retry } = useDelegationTrace(sessionId, row.id, expanded && workOpen);
  const loadEarlierWithAnchor = React.useCallback(async () => {
    const scroller = cardRef.current?.closest('.chat-messages') as HTMLElement | null;
    const priorTop = scroller?.scrollTop ?? 0;
    const priorHeight = scroller?.scrollHeight ?? 0;
    await loadEarlier();
    requestAnimationFrame(() => {
      if (scroller && Math.abs(scroller.scrollTop - priorTop) < 2) {
        scroller.scrollTop = priorTop + scroller.scrollHeight - priorHeight;
      }
    });
  }, [loadEarlier]);
  const header = page.header;
  const executionStatus = header?.mode === 'background' ? header.executionStatus : undefined;
  const rawStatus = executionStatus ?? header?.status ?? (row.status === 'error' ? 'failed' : row.status === 'complete' ? 'complete' : 'running');
  const status = rawStatus === 'completed' ? 'complete' : rawStatus;
  const active = status === 'queued' || status === 'running' || status === 'waiting' || status === 'cancelling';
  const startedAt = header?.startedAt;
  const [, setClock] = React.useState(0);
  React.useEffect(() => {
    if (!active || !startedAt) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active, startedAt]);
  const duration = header ? formatDurationMs(header.startedAt, active ? undefined : header.completedAt) : row.duration;
  const task = header?.task || row.task || t('chat.subagentUntitledTask');
  const profile = header?.profile || row.profile;
  const definition = useAppSettingsStore(state => state.settings.agents.definitions.find(agent => agent.id === profile));
  const mode = profile as AgentMode;
  const agentLabel = definition?.name || getAgentModeConfig(mode)?.label || profile;
  const trace = React.useMemo<ConversationWorkTrace>(() => ({
    status: active ? 'running' : status === 'complete' ? 'complete' : status === 'cancelled' || status === 'interrupted' || status === 'partial' || status === 'blocked' ? 'stopped' : 'error',
    blocks: page.steps.map((step) => step.block), updatedAt: header?.completedAt ?? Date.now(),
  }), [active, status, page.steps, header?.completedAt]);
  const presentation = React.useMemo(() => buildWorkProcessPresentation(trace), [trace]);
  const renderToolDetail = React.useCallback((tool: Extract<WorkProcessRow, { type: 'tool' }>) => (
    tool.status === 'complete' || tool.status === 'error'
      ? <DelegatedToolReceipt sessionId={sessionId} parentToolCallId={row.id} toolCallId={tool.id}
        childSessionId={header?.childSessionId} executionId={header?.executionId} generation={header?.generation} />
      : null
  ), [sessionId, row.id, header?.childSessionId, header?.executionId, header?.generation]);
  const latest = header?.latestAction
    ? label(getToolVerb(header.latestAction, header.latestActionStatus ?? 'complete'))
    : active ? t('chat.subagentStillRunning') : t('chat.subagentProcessEnded');
  const processPreview = page.total ? `${latest} · ${t('chat.subagentStepCount', { count: page.total })}` : latest;
  const finalPreview = headerLoading ? t('chat.subagentLoading') : header?.finalPreview || (header?.finalUnavailableReason
    ? t('chat.subagentContentUnavailable') : active ? t('chat.subagentStillRunning')
      : t('chat.subagentNoFinal'));
  const finalAvailable = !!header?.finalAvailable;
  const progressDots = <SubagentProgressDots state={active ? 'active' : status === 'complete' ? 'complete' : 'stopped'} />;
  return <li ref={cardRef} className={`work-process-subagent is-${status}${expanded ? ' is-expanded' : ''}`}
    data-work-process-block-id={row.id} data-testid="work-process-subagent">
    <WorkCardHeader onClick={() => openCard(active)} expanded={expanded} controls={contentId}
      icon={<ModeGlyph mode={mode} icon={definition?.icon ?? undefined} className="work-process-tool-card-icon" />}
      title={`${t('chat.subagentIdentity')} · ${agentLabel}`} duration={headerLoading ? undefined : duration}
      status={<span className={`work-process-subagent-status is-${status}`}>
        {status === 'queued' ? t('chat.subagentQueued')
          : status === 'waiting' ? t('chat.subagentWaiting')
            : status === 'cancelling' ? t('chat.subagentCancelling')
              : status === 'partial' ? t('chat.subagentPartial')
                : status === 'blocked' ? t('chat.subagentBlocked')
                  : status === 'interrupted' ? t('chat.subagentInterrupted')
          : status === 'cancelled' ? t('chat.subagentCancelled')
            : status === 'complete' ? t('chat.subagentComplete')
              : status === 'failed' ? t('chat.subagentFailed') : label(getRowStatusLabel('running'))}
      </span>} preview={expanded ? undefined : <FadingPreview text={task} />}
      trailingPreview={expanded ? undefined : progressDots} />
    {expanded ? <div id={contentId} className="work-process-subagent-body">
      {page.error ? <p className="work-process-subagent-receipt-error" role="status">{t('chat.subagentTraceUnavailable')}</p> : null}
      <div className="work-process-subagent-task" aria-label={t('chat.subagentTask')}>
        {headerLoading ? <span className="work-process-subagent-note">{t('chat.subagentLoading')}</span> : null}
        <DelegationBody sessionId={sessionId} parentToolCallId={row.id} childSessionId={header?.childSessionId}
          executionId={header?.executionId} generation={header?.generation} kind="task" taskDisclosure={{ factsOpen, constraintsOpen, toggle }} open={expanded} available={!!header?.taskAvailable} />
        {!headerLoading && !header?.taskAvailable ? <span className="work-process-subagent-note">{t('chat.subagentContentUnavailable')}</span> : null}
      </div>
      <WorkDisclosure title={t('chat.subagentProcess')} meta={page.total ? t('chat.subagentStepCount', { count: page.total }) : undefined} preview={processPreview} open={workOpen}
        onToggle={() => toggle('workOpen')} bodyClassName="work-process-subagent-process-body">
        {hasEarlier ? <button type="button" className="work-process-subagent-more" onClick={() => void loadEarlierWithAnchor()}>
          {t('chat.subagentShowEarlier')}</button> : null}
        {loading || headerLoading ? <span className="work-process-subagent-note">{t('chat.subagentLoading')}</span> : null}
        {page.error ? <button type="button" className="work-process-subagent-more" onClick={retry}>{t('chat.subagentRetry')}</button> : null}
        {!loading && !headerLoading && !page.error && page.steps.length === 0 ? <span className="work-process-subagent-note">{t('chat.subagentNoActions')}</span> : null}
        <WorkProcessContent embedded density="compact" presentation={presentation} sessionId={sessionId} renderToolDetail={renderToolDetail}
          disclosureScope={`${sessionId ?? ''}\u0000${row.id}`} />
      </WorkDisclosure>
      <WorkDisclosure title={t('chat.subagentFinal')} preview={finalPreview} open={finalOpen}
        onToggle={() => toggle('finalOpen')} disabled={!finalAvailable}>
        <DelegationBody sessionId={sessionId} parentToolCallId={row.id} childSessionId={header?.childSessionId}
          executionId={header?.executionId} generation={header?.generation} kind="final" open={finalOpen} available={finalAvailable} />
      </WorkDisclosure>
      <WorkDisclosure title={t('chat.subagentDetails')} preview={t('chat.subagentDetailsPreview')} open={detailsOpen}
        onToggle={() => toggle('detailsOpen')}>
        <ScopedWorkDisclosure scope={`${sessionId ?? ''}:${row.id}:details`}><SubagentCallDetails header={header} sessionId={sessionId} parentToolCallId={row.id}
          executionId={row.executionId} generation={row.generation} /></ScopedWorkDisclosure>
      </WorkDisclosure>
    </div> : null}
  </li>;
};
