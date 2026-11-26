import { describe, expect, it } from 'vitest';
import { createContinuationDropNotice, summarizeContinuationDrop } from './ConversationContinuationNotice';
import { reconcileInterruptedConversationTurn } from './DelegatedInteractionRecovery';
import type { ConversationMessage } from '@shared/types/conversation';
import type { RequestPlan } from '@shared/types/providerCapability';

const next = { providerId: 'openai', effectiveModelId: 'gpt-6.1-terra' } as RequestPlan;
const counts = (...entries: Array<[string, number]>) => entries.map(([reason, count]) => ({ reason, count }));

describe('summarizeContinuationDrop', () => {
  it('counts artifacts dropped by a route or model change with the reason breakdown', () => {
    expect(
      summarizeContinuationDrop(
        counts(['execution-mismatch', 3], ['model-not-admitted', 1], ['container-mismatch', 2], ['exact-execution', 5]),
      ),
    ).toEqual({
      count: 6,
      reasons: [
        { reason: 'execution-mismatch', count: 3 },
        { reason: 'model-not-admitted', count: 1 },
        { reason: 'container-mismatch', count: 2 },
      ],
    });
  });

  it('stays silent when nothing was dropped, including when the model changed but no artifacts existed', () => {
    expect(summarizeContinuationDrop([])).toBeNull();
    expect(summarizeContinuationDrop(counts(['no-artifact', 4]))).toBeNull();
  });

  it('stays silent for routine drops such as scope end, retention expiry or provider-managed state', () => {
    expect(
      summarizeContinuationDrop(
        counts(['scope-ended', 2], ['retention-expired', 7], ['provider-managed', 1], ['invalid-integrity', 1]),
      ),
    ).toBeNull();
  });
});

describe('createContinuationDropNotice', () => {
  const options = {
    requestId: 'request-1',
    turnId: 'turn-1',
    sessionId: 'session-1',
    projectId: 'project-1',
    branchId: 'root',
    next,
  };

  it('carries the structured count so the renderer can localize it', () => {
    const drop = { count: 2, reasons: [{ reason: 'execution-mismatch', count: 2 }] };
    const notice = createContinuationDropNotice({ ...options, drop });
    expect(notice).toMatchObject({
      role: 'system',
      turnId: 'turn-1',
      diagnostic: {
        code: 'MODEL_CONTINUATION_DROPPED',
        severity: 'warning',
        providerId: 'openai',
        modelId: 'gpt-6.1-terra',
        continuationDrop: drop,
      },
    });
    expect(notice.content).toContain('2');
  });

  it('an approval-time switch yields exactly one notice for the turn', () => {
    const drop = summarizeContinuationDrop(counts(['execution-mismatch', 1]));
    const notices = [drop].flatMap((entry) =>
      entry ? [createContinuationDropNotice({ ...options, drop: entry })] : [],
    );
    expect(notices).toHaveLength(1);
  });
});

describe('restart after an interrupted turn on the same model', () => {
  const interruptedGptTurn: ConversationMessage = {
    id: 'assistant-gpt',
    turnId: 'turn-gpt',
    sessionId: 'session-1',
    projectId: 'project-1',
    role: 'assistant',
    content: 'partial',
    status: 'streaming',
    createdAt: 1,
    updatedAt: 2,
    preparedContext: undefined,
  };

  it('does not announce a drop: the decision comes from this turn only, never from skipped history', () => {
    const recovered = reconcileInterruptedConversationTurn(interruptedGptTurn, false);
    expect(recovered.status).toBe('error');
    // Preparing "继续" on the same GPT model replays or retains everything: nothing is dropped for a route change.
    expect(summarizeContinuationDrop(counts(['exact-execution', 2], ['no-artifact', 1]))).toBeNull();
  });

  it('announces when a third model then drops artifacts', () => {
    expect(summarizeContinuationDrop(counts(['model-not-admitted', 2]))).toMatchObject({ count: 2 });
  });
});
