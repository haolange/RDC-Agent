import { describe, expect, it } from 'vitest';
import { createWorkTraceFixture } from '../fixtures/workTraceFixture';
import { applyConversationMessageDelta, createConversationMessageDeltaEncoder } from './messageDelta';
import type { ConversationMessage } from '../types/conversation';

const message = (steps: number, overrides: Partial<ConversationMessage> = {}): ConversationMessage => ({
  id: 'assistant-a', turnId: 'turn-a', requestId: 'request-a', role: 'assistant', agentId: 'general',
  sessionId: 'session-a', projectId: 'project-a', content: '', status: 'streaming', createdAt: 1, updatedAt: 2,
  workTrace: createWorkTraceFixture({ steps }),
  ...overrides,
} as ConversationMessage);

describe('conversation message deltas', () => {
  it('rebuilds every sent state, starting from a first send that is complete on its own', () => {
    const encoder = createConversationMessageDeltaEncoder();
    let rebuilt: ConversationMessage | undefined;
    for (const steps of [1, 2, 3, 3, 8]) {
      const sent = message(steps, { updatedAt: steps });
      const delta = encoder.encode(sent);
      if (!delta) continue;
      rebuilt = applyConversationMessageDelta(rebuilt, delta);
      expect(rebuilt).toEqual(sent);
    }
    expect(encoder.snapshot('assistant-a')?.seq).toBe(4);
  });

  it('sends nothing when nothing changed, and only what changed otherwise', () => {
    const encoder = createConversationMessageDeltaEncoder();
    encoder.encode(message(5));
    expect(encoder.encode(message(5))).toBeNull();

    const edited = message(5);
    edited.workTrace!.blocks[1] = { ...edited.workTrace!.blocks[1]!, title: 'Renamed step' };
    const delta = encoder.encode(edited)!;
    expect(delta).toMatchObject({ seq: 2, baseSeq: 1, fields: {} });
    expect(delta.trace?.blocks.map((block) => block.id)).toEqual(['loop-1']);
    expect(delta.trace?.blockIds).toBeUndefined();
  });

  it('carries removed fields and a removed trace', () => {
    const encoder = createConversationMessageDeltaEncoder();
    const first = message(2, { diagnostic: { code: 'CONVERSATION_LLM_REQUEST_FAILED', severity: 'error', userMessage: 'u' } } as Partial<ConversationMessage>);
    const rebuiltFirst = applyConversationMessageDelta(undefined, encoder.encode(first)!);
    const second = { ...message(0), workTrace: null } as ConversationMessage;
    const delta = encoder.encode(second)!;
    expect(delta.removed).toEqual(['diagnostic']);
    expect(delta.trace).toBeNull();
    expect(applyConversationMessageDelta(rebuiltFirst, delta)).toEqual(second);
  });

  it('keeps one update the same size at step 100 as at step 10', () => {
    const bytesOfNextStep = (steps: number) => {
      const encoder = createConversationMessageDeltaEncoder();
      encoder.encode(message(steps));
      return JSON.stringify(encoder.encode(message(steps + 1))).length;
    };
    expect(bytesOfNextStep(100) / bytesOfNextStep(10)).toBeLessThan(2);
  });
});
