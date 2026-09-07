import { describe, expect, it, vi } from 'vitest';
import type { ConversationMessage } from '@shared/types/conversation';
import { selectActiveAssistantForTurn } from './composerStopSelection';
import { stopWorkTrace } from './useComposerStop';

function activeAssistant(overrides: Partial<ConversationMessage>): ConversationMessage {
  return {
    id: 'assistant-default',
    turnId: 'turn-default',
    sessionId: 'session-1',
    projectId: 'project-1',
    requestId: 'request-default',
    role: 'assistant',
    agentId: 'edit',
    content: '',
    status: 'streaming',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('stopWorkTrace', () => {
  it('optimistically marks the active assistant message and running work rows as stopped locally', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const message: ConversationMessage = {
      id: 'assistant-1',
      turnId: 'turn-1',
      sessionId: 'session-1',
      projectId: null,
      role: 'assistant',
      content: 'partial',
      status: 'streaming',
      createdAt: 1,
      updatedAt: 1,
      workTrace: {
        status: 'running',
        summary: 'Running',
        updatedAt: 1,
        blocks: [
          {
            id: 'runtime-run',
            kind: 'reasoning',
            title: 'Agent Loop',
            stage: 'preflight',
            status: 'running',
            summary: 'Running',
            startedAt: 1,
            toolCalls: [],
          },
          {
            id: 'assistant-output',
            kind: 'output',
            title: 'Answer',
            stage: 'respond',
            status: 'complete',
            summary: 'Partial',
            startedAt: 1,
            toolCalls: [],
          },
        ],
      },
    };

    const stopped = stopWorkTrace(message);

    expect(stopped.status).toBe('stopped');
    expect(stopped.workTrace?.status).toBe('stopped');
    expect(stopped.workTrace?.blocks[0]).toMatchObject({
      status: 'complete',
      completedAt: Date.now(),
    });
    expect(stopped.workTrace?.blocks[1].status).toBe('complete');
    vi.useRealTimers();
  });
});

describe('selectActiveAssistantForTurn', () => {
  it('selects only the active turn owned by the current session, request, and agent', () => {
    const owned = activeAssistant({
      id: 'owned',
      turnId: 'turn-owned',
      requestId: 'request-owned',
      agentId: 'plan',
    });
    const unrelatedLatest = activeAssistant({
      id: 'unrelated',
      turnId: 'turn-unrelated',
      requestId: 'request-unrelated',
      agentId: 'edit',
      createdAt: 2,
      updatedAt: 2,
    });

    expect(selectActiveAssistantForTurn(
      [owned, unrelatedLatest],
      'session-1',
      {
        sessionId: 'session-1',
        projectId: 'project-1',
        requestId: 'request-owned',
        agentId: 'plan',
        optimisticTurnId: null,
        realTurnId: 'turn-owned',
      },
    )?.id).toBe('owned');
  });

  it('does not fall back to a different agent when the scoped active turn has no message', () => {
    expect(selectActiveAssistantForTurn(
      [activeAssistant({ agentId: 'ask' })],
      'session-1',
      {
        sessionId: 'session-1',
        projectId: 'project-1',
        requestId: 'request-edit',
        agentId: 'edit',
        optimisticTurnId: 'optimistic-turn-request-edit',
        realTurnId: null,
      },
    )).toBeNull();
  });

  it('falls back only within the selected session when runtime state was restored', () => {
    const otherSession = activeAssistant({ id: 'other', sessionId: 'session-2', updatedAt: 3 });
    const selectedSession = activeAssistant({ id: 'selected', sessionId: 'session-1', updatedAt: 2 });

    expect(selectActiveAssistantForTurn(
      [selectedSession, otherSession],
      'session-1',
      null,
    )?.id).toBe('selected');
  });
});
