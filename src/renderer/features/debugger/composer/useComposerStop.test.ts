import { describe, expect, it, vi } from 'vitest';
import type { ConversationMessage } from '@shared/types/conversation';
import { stopWorkTrace } from './useComposerStop';

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
