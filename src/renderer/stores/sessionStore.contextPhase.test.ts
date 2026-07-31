import { beforeEach, describe, expect, it } from 'vitest';
import type { PreparedTurnContextSummary, RunContextUsageSummary } from '@shared/types/session';
import { useSessionStore } from './sessionStore';

const prepared = (overrides: Partial<PreparedTurnContextSummary> = {}): PreparedTurnContextSummary => ({
  requestId: 'request-1',
  turnId: 'turn-1',
  route: {
    providerId: 'provider-a',
    adapterId: 'openai-responses',
    selectedModelId: 'model-a',
    effectiveModelId: 'model-a-fast',
    protocol: 'OpenAIResponses',
    catalogRevision: 'catalog-1',
    routeRevision: 'route-1',
    bindingIds: ['fast:model-a-fast'],
  },
  wirePatch: { headers: {}, body: {} },
  controls: { reasoningLevel: 'high', maxContextMode: false, fastModel: true },
  contextMode: 'normal',
  preparedInputTokens: 40,
  uncompactedInputTokens: 40,
  promptBudgetTokens: 100,
  contextWindowTokens: 128,
  usagePercent: 40,
  breakdown: [],
  compactionApplied: false,
  filteredArtifactCount: 0,
  preparedAt: 100,
  ...overrides,
  continuation: overrides.continuation ?? {
    executionFingerprint: 'test-execution',
    strategy: 'semantic-replay',
    replayedArtifactCount: 0,
    droppedArtifactCount: 0,
    decisionCounts: [],
  },
  derivedContext: overrides.derivedContext ?? { status: 'none', compactedTurnCount: 0 },
  cache: overrides.cache ?? {
    enabled: false,
    mode: 'none',
    keyCarrier: 'none',
    breakpointCarrier: 'none',
    ttl: 'none',
    breakpoint: 'none',
    stableTokenEstimate: 0,
    stableSegmentCount: 0,
    providerReported: false,
    reason: 'test fixture',
  },
});

const usage = (overrides: Partial<RunContextUsageSummary> = {}): RunContextUsageSummary => ({
  runId: 'session-1',
  providerId: 'provider-a',
  modelId: 'model-a-fast',
  inputTokens: 44,
  outputTokens: 6,
  totalTokens: 50,
  contextWindowTokens: 128,
  usagePercent: 34,
  occupiedTokens: 44,
  breakdown: [],
  snapshotAt: 110,
  ...overrides,
});

describe('session context display phases', () => {
  beforeEach(() => {
    useSessionStore.setState({
      currentRunUsage: null,
      lastKnownUsage: null,
      usageStale: false,
      preparedTurnContext: null,
      conversationPreparationPhase: 'idle',
      conversationTerminalTurnId: null,
    });
  });

  it('shows provider usage as Actual until the matching turn reaches terminal state', () => {
    const store = useSessionStore.getState();
    store.setPreparedTurnContext(prepared());
    store.setConversationPreparationPhase('current');
    store.setCurrentRunUsage(usage());

    expect(useSessionStore.getState()).toMatchObject({
      conversationPreparationPhase: 'actual',
      preparedTurnContext: expect.objectContaining({ turnId: 'turn-1' }),
    });

    useSessionStore.getState().markConversationTurnTerminal('turn-1');
    expect(useSessionStore.getState()).toMatchObject({
      conversationPreparationPhase: 'idle',
      preparedTurnContext: null,
    });
  });

  it('keeps a hidden prepared identity until late terminal usage is matched', () => {
    const store = useSessionStore.getState();
    store.setPreparedTurnContext(prepared());
    store.setConversationPreparationPhase('current');
    store.markConversationTurnTerminal('turn-1');

    expect(useSessionStore.getState()).toMatchObject({
      conversationPreparationPhase: 'idle',
      conversationTerminalTurnId: 'turn-1',
      preparedTurnContext: expect.objectContaining({ turnId: 'turn-1' }),
    });

    useSessionStore.getState().setCurrentRunUsage(usage());
    expect(useSessionStore.getState()).toMatchObject({
      conversationPreparationPhase: 'idle',
      conversationTerminalTurnId: null,
      preparedTurnContext: null,
    });
  });

  it('does not replace Current request with usage from another route', () => {
    const store = useSessionStore.getState();
    store.setPreparedTurnContext(prepared());
    store.setConversationPreparationPhase('current');
    store.setCurrentRunUsage(usage({ providerId: 'provider-b' }));

    expect(useSessionStore.getState().conversationPreparationPhase).toBe('current');
  });
  it('keeps Last actual after terminal completion and marks restored usage stale only when requested', () => {
    const store = useSessionStore.getState();
    store.setPreparedTurnContext(prepared());
    store.setConversationPreparationPhase('current');
    store.setCurrentRunUsage(usage());
    store.markConversationTurnTerminal('turn-1');

    expect(useSessionStore.getState()).toMatchObject({
      conversationPreparationPhase: 'idle',
      currentRunUsage: expect.objectContaining({ runId: 'session-1' }),
      lastKnownUsage: expect.objectContaining({ runId: 'session-1' }),
      usageStale: false,
    });

    useSessionStore.getState().setCurrentRunUsage(usage({ snapshotAt: 120 }), true);
    expect(useSessionStore.getState()).toMatchObject({
      lastKnownUsage: expect.objectContaining({ snapshotAt: 120 }),
      usageStale: true,
    });
  });
  it('clears Last actual when the authoritative session read has no telemetry', () => {
    const store = useSessionStore.getState();
    store.setCurrentRunUsage(usage());
    store.setCurrentRunUsage(null);

    expect(useSessionStore.getState()).toMatchObject({
      currentRunUsage: null,
      lastKnownUsage: null,
      usageStale: false,
    });
  });

  it('drops a telemetry-free zero snapshot from a late session projection', () => {
    const store = useSessionStore.getState();
    store.setCurrentRunUsage(usage());
    store.setCurrentRunUsage(usage({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      occupiedTokens: 0,
    }));

    expect(useSessionStore.getState().lastKnownUsage).toBeNull();
  });

});
