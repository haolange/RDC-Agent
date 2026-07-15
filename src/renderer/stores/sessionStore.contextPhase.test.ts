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
});
