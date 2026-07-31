import type {
  PreparedTurnContextSummary,
  RunContextUsageSummary,
} from '@shared/types/session';

export type ConversationPreparationPhase = 'idle' | 'preparing' | 'current' | 'actual';

export interface ContextUsageProjectionState {
  currentRunUsage: RunContextUsageSummary | null;
  lastKnownUsage: RunContextUsageSummary | null;
  usageStale: boolean;
  preparedTurnContext: PreparedTurnContextSummary | null;
  conversationPreparationPhase: ConversationPreparationPhase;
  conversationTerminalTurnId: string | null;
}

export const createEmptyContextUsageProjection = (): ContextUsageProjectionState => ({
  currentRunUsage: null,
  lastKnownUsage: null,
  usageStale: false,
  preparedTurnContext: null,
  conversationPreparationPhase: 'idle',
  conversationTerminalTurnId: null,
});

function hasMaterialContextUsage(usage: RunContextUsageSummary): boolean {
  return [
    usage.inputTokens,
    usage.outputTokens,
    usage.totalTokens,
    usage.occupiedTokens,
    usage.cacheReadTokens,
    usage.cacheWriteTokens,
    usage.cacheHitTokens,
    usage.cacheMissTokens,
    usage.reasoningTokens,
    usage.cost?.total,
    usage.cumulativeCost,
  ].some((value) => typeof value === 'number' && value > 0);
}
function usageMatchesPreparedContext(
  prepared: PreparedTurnContextSummary | null,
  usage: RunContextUsageSummary,
): boolean {
  return Boolean(
    prepared
    && usage.snapshotAt !== null
    && usage.snapshotAt >= prepared.preparedAt
    && usage.providerId === prepared.route.providerId
    && [prepared.route.selectedModelId, prepared.route.effectiveModelId].includes(usage.modelId),
  );
}

export function acceptsContextUsage(
  state: ContextUsageProjectionState,
  usage: RunContextUsageSummary,
  activeRunId: string | null,
): boolean {
  if (activeRunId) return usage.runId === activeRunId;
  if (state.preparedTurnContext) return usage.runId === state.preparedTurnContext.turnId;
  if (state.conversationTerminalTurnId) return usage.runId === state.conversationTerminalTurnId;
  if (
    state.currentRunUsage?.runId === usage.runId
    && state.currentRunUsage.snapshotAt !== null
    && usage.snapshotAt !== null
  ) {
    return usage.snapshotAt >= state.currentRunUsage.snapshotAt;
  }
  return state.currentRunUsage === null || state.currentRunUsage.runId === usage.runId;
}

export function applyContextUsage(
  state: ContextUsageProjectionState,
  usage: RunContextUsageSummary | null,
  stale: boolean,
): ContextUsageProjectionState {
  if (!usage || !hasMaterialContextUsage(usage)) {
    return {
      ...state,
      currentRunUsage: null,
      lastKnownUsage: null,
      usageStale: stale,
    };
  }

  const providerActualIsNewer = usageMatchesPreparedContext(state.preparedTurnContext, usage);
  const terminalAlreadyObserved = providerActualIsNewer
    && state.conversationTerminalTurnId === state.preparedTurnContext?.turnId;

  return {
    ...state,
    currentRunUsage: usage,
    lastKnownUsage: usage,
    usageStale: stale,
    ...(providerActualIsNewer
      ? terminalAlreadyObserved
        ? {
            preparedTurnContext: null,
            conversationPreparationPhase: 'idle' as const,
            conversationTerminalTurnId: null,
          }
        : { conversationPreparationPhase: 'actual' as const }
      : {}),
  };
}

export function setPreparedContext(
  state: ContextUsageProjectionState,
  preparedTurnContext: PreparedTurnContextSummary | null,
): ContextUsageProjectionState {
  return {
    ...state,
    preparedTurnContext,
    ...(preparedTurnContext ? { conversationTerminalTurnId: null } : {}),
  };
}

export function setContextPreparationPhase(
  state: ContextUsageProjectionState,
  conversationPreparationPhase: ConversationPreparationPhase,
): ContextUsageProjectionState {
  return {
    ...state,
    conversationPreparationPhase,
    ...(conversationPreparationPhase === 'preparing' ? { conversationTerminalTurnId: null } : {}),
  };
}

export function markContextTurnTerminal(
  state: ContextUsageProjectionState,
  turnId: string,
  awaitLateUsage = true,
): ContextUsageProjectionState {
  if (state.preparedTurnContext?.turnId !== turnId) return state;
  const actualAlreadyObserved = state.conversationPreparationPhase === 'actual';
  return {
    ...state,
    conversationPreparationPhase: 'idle',
    conversationTerminalTurnId: actualAlreadyObserved || !awaitLateUsage ? null : turnId,
    ...(actualAlreadyObserved || !awaitLateUsage ? { preparedTurnContext: null } : {}),
  };
}
