import { beforeEach, describe, expect, it } from 'vitest';
import type { ConversationMessage } from '@shared/types/conversation';
import type { PreparedTurnContextSummary, RunContextUsageSummary } from '@shared/types/session';
import { useConversationStore } from './conversationStore';
import { useWorkflowStore } from './workflowStore';
import { useCaptureStore } from './captureStore';
import { useSessionProjectionStore } from './sessionProjectionStore';
import { useSessionStore } from './sessionStore';

const message = (overrides: Partial<ConversationMessage> = {}): ConversationMessage => ({
  id: 'msg-1',
  turnId: 'turn-1',
  sessionId: 'session-a',
  projectId: 'project-1',
  role: 'assistant',
  content: 'from a',
  status: 'streaming',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const preparedUsageContext = (turnId: string): PreparedTurnContextSummary => ({
  requestId: `request-${turnId}`,
  turnId,
  route: {
    providerId: 'provider-a',
    adapterId: 'openai-responses',
    selectedModelId: 'model-a',
    effectiveModelId: 'model-a',
    protocol: 'OpenAIResponses',
    catalogRevision: 'catalog-1',
    routeRevision: 'route-1',
    bindingIds: [],
  },
  wirePatch: { headers: {}, body: {} },
  controls: { reasoningLevel: 'high', maxContextMode: false, fastModel: false },
  contextMode: 'normal',
  preparedInputTokens: 20,
  uncompactedInputTokens: 20,
  promptBudgetTokens: 100,
  contextWindowTokens: 100,
  maxOutputTokens: 0,
  compactionThresholdTokens: 80,
  usagePercent: 20,
  breakdown: [],
  compactionApplied: false,
  filteredArtifactCount: 0,
  preparedAt: 10,
  continuation: { executionFingerprint: 'test', strategy: 'semantic-replay', replayedArtifactCount: 0, droppedArtifactCount: 0, decisionCounts: [] },
  cache: { enabled: false, mode: 'none', keyCarrier: 'none', breakpointCarrier: 'none', ttl: 'none', breakpoint: 'none', stableTokenEstimate: 0, stableSegmentCount: 0, providerReported: false, reason: 'test' },
});

const usageSnapshot = (
  runId: string,
  overrides: Partial<RunContextUsageSummary> = {},
): RunContextUsageSummary => ({
  runId,
  providerId: 'provider-a',
  modelId: 'model-a',
  inputTokens: 20,
  outputTokens: 2,
  totalTokens: 22,
  promptBudgetTokens: 100,
  contextWindowTokens: 100,
  maxOutputTokens: 0,
  compactionThresholdTokens: 80,
  usagePercent: 22,
  occupiedTokens: 20,
  breakdown: [],
  snapshotAt: 20,
  ...overrides,
});
describe('sessionProjectionStore', () => {
  beforeEach(() => {
    useConversationStore.getState().reset();
    useWorkflowStore.getState().reset();
    useCaptureStore.getState().reset();
    useSessionProjectionStore.getState().reset();
    useSessionStore.getState().clearUsageSnapshot();
    useSessionStore.getState().setCurrentRun(null);
  });

  it('caches background conversation patches and hydrates on activate', () => {
    useSessionProjectionStore.getState().projectConversationMessage(
      'session-a',
      message({ content: 'cached stream', updatedAt: 2 }),
    );
    expect(useConversationStore.getState().conversationMessages).toHaveLength(0);

    const hydrated = useSessionProjectionStore.getState().activateSession('session-a');
    expect(hydrated).toBe(true);
    expect(useConversationStore.getState().conversationMessages[0]?.content).toBe('cached stream');
  });

  it('captureActiveSession snapshots current UI into cache', () => {
    useConversationStore.getState().upsertConversationMessage(message({ content: 'active' }));
    useSessionProjectionStore.getState().captureActiveSession('session-a');
    useConversationStore.getState().reset();

    expect(useSessionProjectionStore.getState().activateSession('session-a')).toBe(true);
    expect(useConversationStore.getState().conversationMessages[0]?.content).toBe('active');
  });

  it('hydrates only the cached session context and opened capture', () => {
    const contextSnapshot = {
      contextId: 'context-a',
      sessionId: 'session-a',
      backend: 'local',
      runtimeOwner: 'owner-a',
      ownerLeaseId: 'lease-a',
      activeCapture: 'capture-a',
      deviceLabel: 'Local',
      captureDescriptors: [{ id: 'capture-a', filePath: 'D:/a.rdc', role: 'primary', backendHint: 'local', status: 'open' }],
    } as never;
    const openedCapture = {
      projectId: 'project-a',
      ownerSessionId: 'session-a',
      filePath: 'D:/a.rdc',
      status: 'open',
    } as never;
    const projection = useSessionProjectionStore.getState();
    projection.projectContextSnapshot('session-a', contextSnapshot);
    projection.projectOpenedCapture('session-a', openedCapture);

    expect(projection.activateSession('session-a')).toBe(true);
    expect(useCaptureStore.getState().contextSnapshot?.contextId).toBe('context-a');
    expect(useCaptureStore.getState().openedCapture?.projectId).toBe('project-a');
    expect(useCaptureStore.getState().captures.map((capture) => capture.id)).toEqual(['capture-a']);
  });
  it('evictSession removes cache', () => {
    useSessionProjectionStore.getState().projectConversationMessage('session-a', message());
    useSessionProjectionStore.getState().evictSession('session-a');
    expect(useSessionProjectionStore.getState().activateSession('session-a')).toBe(false);
  });
  it('accepts the prepared turn usage when its durable run id differs from the conversation turn id', () => {
    const session = useSessionStore.getState();
    session.setPreparedTurnContext(preparedUsageContext('turn-a'));
    session.setConversationPreparationPhase('current');
    useSessionProjectionStore.getState().captureActiveSession('session-a');
    session.clearUsageSnapshot();

    const projection = useSessionProjectionStore.getState();
    projection.projectConversationTerminal('session-a', 'turn-a', true);
    projection.projectRunUsage('session-a', usageSnapshot('run-a'), null);

    expect(projection.activateSession('session-a')).toBe(true);
    expect(useSessionStore.getState()).toMatchObject({
      conversationPreparationPhase: 'idle',
      preparedTurnContext: null,
      lastKnownUsage: expect.objectContaining({ runId: 'run-a' }),
    });
  });

  it('drops a stale background usage snapshot from before the prepared turn', () => {
    const projection = useSessionProjectionStore.getState();
    const active = useSessionStore.getState();
    active.clearUsageSnapshot();
    active.setPreparedTurnContext(preparedUsageContext('turn-b'));
    active.setConversationPreparationPhase('current');
    projection.captureActiveSession('session-b');
    projection.projectRunUsage('session-b', usageSnapshot('run-a', { snapshotAt: 5 }), null);

    expect(useSessionProjectionStore.getState().bySessionId['session-b']?.contextUsage.lastKnownUsage).toBeNull();
  });
});
