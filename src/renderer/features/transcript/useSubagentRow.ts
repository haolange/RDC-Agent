import React from 'react';
import { getAgentModeConfig } from '@shared/constants/agents';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { useI18n } from '../../i18n';
import { withLanguage } from '../../i18n/messages';
import { EFFORT_LABEL_KEYS, isReasoningLevelLabel } from '../../lib/reasoningLabels';
import { useModelDisplayLabel } from '../../hooks/useModelDisplayLabel';
import { getToolVerb } from './workProcessToolRows';
import { formatDurationMs } from './workProcessFormat';
import { useWorkClock } from './useWorkClock';
import { buildWorkProcessPresentation } from './workProcessTracePresentation';
import { useDelegationTrace } from './useDelegationTrace';
import { isActiveSubagentStatus, subagentStatus, subagentTraceStatus, type SubagentWorkRow } from './subagentRowModel';
import type { AgentMode } from '@shared/types/layout';
import type { ConversationWorkTrace } from '@shared/types/conversation';

/** What a delegation card shows: its trace page, state, Agent and route, and the previews of its sections. */
export function useSubagentRow(row: SubagentWorkRow, sessionId: string | null | undefined, historyOpen: boolean, workOpen: boolean) {
  const { t, language } = useI18n();
  const delegation = useDelegationTrace(sessionId, row.id, historyOpen);
  const { page, headerLoading } = delegation;
  const header = page.header;
  const status = subagentStatus(row, header);
  const active = isActiveSubagentStatus(status);
  // The delegated Agent's clock advances on the same shared second as the turn's Working header.
  const now = useWorkClock(active && Boolean(header?.startedAt));
  const duration = header ? formatDurationMs(language, header.startedAt, active ? now : header.completedAt) : row.duration;
  const profile = header?.profile || row.profile;
  const definition = useAppSettingsStore(state => state.settings.agents.definitions.find(agent => agent.id === profile));
  const mode = profile as AgentMode;
  const trace = React.useMemo<ConversationWorkTrace>(() => ({
    status: subagentTraceStatus(status),
    blocks: page.steps.map((step) => step.block), updatedAt: header?.completedAt ?? Date.now(),
  }), [status, page.steps, header?.completedAt]);
  const localized = React.useMemo(() => withLanguage(t, language), [t, language]);
  const presentation = React.useMemo(() => buildWorkProcessPresentation(trace, localized), [trace, localized]);
  const route = header?.preparedRoute;
  const modelLabel = useModelDisplayLabel(route?.providerId, route?.modelId);
  return {
    ...delegation,
    header,
    status,
    active,
    duration,
    mode,
    definition,
    presentation,
    task: header?.task || row.task || t('chat.subagentUntitledTask'),
    agentLabel: definition?.name || getAgentModeConfig(mode)?.label || profile,
    // The glyph already says this is a delegation; the header names the Agent, then the model and its reasoning level.
    routeLabel: route && modelLabel
      ? [modelLabel, isReasoningLevelLabel(route.reasoningLevel) ? t(EFFORT_LABEL_KEYS[route.reasoningLevel]) : ''].filter(Boolean).join(' · ')
      : '',
    processPreview: header?.latestAction
      ? getToolVerb(header.latestAction, header.latestActionStatus ?? 'complete', undefined, t)
      : active ? t('chat.subagentStillRunning') : t('chat.subagentProcessEnded'),
    finalPreview: headerLoading ? t('chat.subagentLoading') : header?.finalPreview || (header?.finalUnavailableReason
      ? t('chat.subagentContentUnavailable') : active ? t('chat.subagentStillRunning') : t('chat.subagentNoFinal')),
    finalAvailable: !!header?.finalAvailable,
    finalShownInProcess: workOpen && page.steps.some((step) => step.block.items
      ?.some((item) => item.kind === 'text' && item.phase === 'final_answer')),
  };
}

export type SubagentRowState = ReturnType<typeof useSubagentRow>;
