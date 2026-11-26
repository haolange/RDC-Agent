import React from 'react';
import { useI18n } from '../../i18n';
import { InlineError } from '../../ui/InlineError';
import { Skeleton } from '../../ui/Skeleton';
import { useSettingsNavigationStore } from '../../stores/settingsNavigationStore';
import { ScopedWorkDisclosure } from './ScopedWorkDisclosure';
import { WorkProcessContent } from './WorkProcessContent';
import { SubagentCallDetails } from './SubagentCallDetails';
import { DelegatedToolReceipt } from './DelegatedToolReceipt';
import { DelegationBody } from './DelegationBody';
import { WorkDisclosure } from './WorkDisclosure';
import type { useSubagentDisclosure } from './useSubagentDisclosure';
import type { SubagentRowState } from './useSubagentRow';
import type { SubagentWorkRow } from './subagentRowModel';
import type { WorkProcessRow } from './workProcessTypes';

/** An opened delegation: its task, then its work process, final reply and call details as separate disclosures. */
export function SubagentRowBody({
  id,
  row,
  sessionId,
  state,
  disclosure,
}: {
  id: string;
  row: SubagentWorkRow;
  sessionId?: string | null;
  state: SubagentRowState;
  disclosure: ReturnType<typeof useSubagentDisclosure>;
}) {
  const { t } = useI18n();
  const openAgentSettings = useSettingsNavigationStore((store) => store.openAgent);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const { page, loading, headerLoading, hasEarlier, loadEarlier, retry, header, status } = state;
  const { expanded, workOpen, finalOpen, detailsOpen, factsOpen, constraintsOpen, toggle } = disclosure;
  const delegation = {
    sessionId,
    parentToolCallId: row.id,
    childSessionId: header?.childSessionId,
    executionId: header?.executionId,
    generation: header?.generation,
  };
  // Earlier steps load above what the reader sees; the transcript keeps its reading position.
  const loadEarlierWithAnchor = React.useCallback(async () => {
    const scroller = bodyRef.current?.closest('.chat-messages') as HTMLElement | null;
    const priorTop = scroller?.scrollTop ?? 0;
    const priorHeight = scroller?.scrollHeight ?? 0;
    await loadEarlier();
    requestAnimationFrame(() => {
      if (scroller && Math.abs(scroller.scrollTop - priorTop) < 2) {
        scroller.scrollTop = priorTop + scroller.scrollHeight - priorHeight;
      }
    });
  }, [loadEarlier]);
  const renderToolDetail = React.useCallback(
    (tool: Extract<WorkProcessRow, { type: 'tool' }>) =>
      tool.status === 'complete' ||
      tool.status === 'error' ||
      tool.status === 'cancelled' ||
      tool.status === 'skipped' ? (
        <DelegatedToolReceipt
          sessionId={sessionId}
          parentToolCallId={row.id}
          toolCallId={tool.id}
          childSessionId={header?.childSessionId}
          executionId={header?.executionId}
          generation={header?.generation}
        />
      ) : null,
    [sessionId, row.id, header?.childSessionId, header?.executionId, header?.generation],
  );
  const loadingLines = (
    <span role="status" aria-label={t('chat.subagentLoading')}>
      <Skeleton shape="line" count={2} inline />
    </span>
  );

  return (
    <div ref={bodyRef} id={id} className="work-process-subagent-body">
      {page.error ? (
        <p className="work-process-subagent-receipt-error" role="status">
          {t('chat.subagentTraceUnavailable')}
        </p>
      ) : null}
      {header?.status === 'failed' && header.configurationError ? (
        <InlineError
          detail={header.error}
          onRetry={() => openAgentSettings(header.profile)}
          retryLabel={t('chat.subagentOpenAgentSettings')}
        >
          {t('chat.subagentConfigurationFailed')}
        </InlineError>
      ) : null}
      {!headerLoading && !header && status === 'failed' && row.resultPreview ? (
        <InlineError detail={row.resultPreview}>{t('chat.subagentFailedSummary')}</InlineError>
      ) : null}
      <div className="work-process-subagent-task" aria-label={t('chat.subagentTask')}>
        {headerLoading ? (
          <span role="status" aria-label={t('chat.subagentLoading')}>
            <Skeleton shape="line" inline />
          </span>
        ) : null}
        {!headerLoading && !header && row.task ? <span className="work-process-subagent-note">{row.task}</span> : null}
        <DelegationBody
          {...delegation}
          kind="task"
          taskDisclosure={{ factsOpen, constraintsOpen, toggle }}
          open={expanded}
          available={!!header?.taskAvailable}
        />
        {!headerLoading && header && !header.taskAvailable ? (
          <span className="work-process-subagent-note">{t('chat.subagentContentUnavailable')}</span>
        ) : null}
      </div>
      <WorkDisclosure
        title={t('chat.subagentProcess')}
        preview={state.processPreview}
        open={workOpen}
        onToggle={() => toggle('workOpen')}
        bodyClassName="work-process-subagent-process-body"
      >
        {loading || headerLoading ? loadingLines : null}
        {page.error ? (
          <button type="button" className="work-process-subagent-more" onClick={retry}>
            {t('chat.subagentRetry')}
          </button>
        ) : null}
        {!loading && !headerLoading && !page.error && page.steps.length === 0 ? (
          <span className="work-process-subagent-note">{t('chat.subagentNoActions')}</span>
        ) : null}
        <WorkProcessContent
          embedded
          density="compact"
          presentation={state.presentation}
          sessionId={sessionId}
          renderToolDetail={renderToolDetail}
          active={row.status === 'running'}
          leadingContent={
            hasEarlier ? (
              <button type="button" className="work-process-subagent-more" onClick={() => void loadEarlierWithAnchor()}>
                {t('chat.subagentShowEarlier')}
              </button>
            ) : null
          }
          disclosureScope={`${sessionId ?? ''}\u0000${row.id}`}
        />
      </WorkDisclosure>
      <WorkDisclosure
        title={t('chat.subagentFinal')}
        preview={state.finalPreview}
        open={finalOpen}
        onToggle={() => toggle('finalOpen')}
        disabled={!state.finalAvailable}
      >
        {state.finalShownInProcess ? (
          <span className="work-process-subagent-note">{t('chat.subagentFinalShownAbove')}</span>
        ) : (
          <DelegationBody {...delegation} kind="final" open={finalOpen} available={state.finalAvailable} />
        )}
      </WorkDisclosure>
      <WorkDisclosure title={t('chat.subagentDetails')} open={detailsOpen} onToggle={() => toggle('detailsOpen')}>
        <ScopedWorkDisclosure scope={`${sessionId ?? ''}:${row.id}:details`}>
          <SubagentCallDetails
            header={header}
            sessionId={sessionId}
            parentToolCallId={row.id}
            executionId={row.executionId}
            generation={row.generation}
          />
        </ScopedWorkDisclosure>
      </WorkDisclosure>
    </div>
  );
}
