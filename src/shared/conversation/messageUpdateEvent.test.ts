import { describe, expect, it } from 'vitest';
import { createWorkTraceFixture } from '../fixtures/workTraceFixture';
import { buildMessageUpdateEvent } from './messageUpdateEvent';
import type { ConversationMessage } from '../types/conversation';

const message = (steps: number): ConversationMessage => ({
  id: 'assistant-a', turnId: 'turn-a', requestId: 'request-a', role: 'assistant', agentId: 'general',
  sessionId: 'session-a', projectId: 'project-a', content: '', status: 'streaming', createdAt: 1, updatedAt: 2,
  workTrace: createWorkTraceFixture({ steps }),
} as ConversationMessage);

describe('message update budget', () => {
  /**
   * The update for one more step must cost the same at step 100 as at step 10. Today each update carries the whole
   * message, so it is about ten times larger and a long investigation sends a quadratic total. Turns green with
   * message deltas; `it.fails` reports it then.
   */
  it.fails('sends an update whose size does not grow with the number of steps', () => {
    const bytes = (steps: number) => JSON.stringify(buildMessageUpdateEvent('message_patched', 'session-a', message(steps))).length;
    expect(bytes(100) / bytes(10)).toBeLessThan(2);
  });
});
