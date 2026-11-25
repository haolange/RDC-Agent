import { describe, expect, it, vi } from 'vitest';
import { createWorkTraceFixture } from '../fixtures/workTraceFixture';
import { applyConversationMessageDelta, createConversationMessageDeltaEncoder } from './messageDelta';
import type { ConversationMessage, ConversationWorkBlock } from '../types/conversation';

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

  /** The next commit the way main makes it: the edited block is a copy, every other block is shared. */
  const nextCommit = (sent: ConversationMessage, edit: (blocks: ConversationWorkBlock[]) => ConversationWorkBlock[]) => ({
    ...sent,
    updatedAt: (sent.updatedAt ?? 0) + 1,
    workTrace: { ...sent.workTrace!, blocks: edit(sent.workTrace!.blocks.slice()) },
  });

  it('rebuilds every state when commits share their unchanged blocks, including a removed block that comes back', () => {
    const encoder = createConversationMessageDeltaEncoder();
    const first = message(4);
    let rebuilt = applyConversationMessageDelta(undefined, encoder.encode(first)!);
    const removedBlock = first.workTrace!.blocks[1]!;
    const commits: Array<(blocks: ConversationWorkBlock[]) => ConversationWorkBlock[]> = [
      (blocks) => blocks.map((block, index) => (index === 3 ? { ...block, title: 'Step 4, renamed' } : block)),
      (blocks) => [...blocks, { ...blocks[0]!, id: 'loop-new', title: 'Appended' }],
      (blocks) => blocks.filter((block) => block.id !== removedBlock.id),
      (blocks) => [...blocks, { ...removedBlock }],
      (blocks) => blocks,
    ];
    let sent = first;
    for (const edit of commits) {
      sent = nextCommit(sent, edit);
      const delta = encoder.encode(sent);
      if (delta) rebuilt = applyConversationMessageDelta(rebuilt, delta);
      expect(rebuilt).toEqual(sent);
    }
  });

  it('compares only the blocks a commit changed, so one commit costs the same at step 100 as at step 10', () => {
    const serializedOnNextCommit = (steps: number) => {
      const encoder = createConversationMessageDeltaEncoder();
      const sent = message(steps);
      encoder.encode(sent);
      const next = nextCommit(sent, (blocks) => blocks.map((block, index) => (
        index === blocks.length - 1 ? { ...block, status: 'complete' as const } : block
      )));
      const stringify = vi.spyOn(JSON, 'stringify');
      try {
        expect(encoder.encode(next)?.trace?.blocks.map((block) => block.id)).toEqual([`loop-${steps - 1}`]);
        return stringify.mock.results.reduce((total, result) => total + String(result.value).length, 0);
      } finally {
        stringify.mockRestore();
      }
    };
    expect(serializedOnNextCommit(100) / serializedOnNextCommit(10)).toBeLessThan(1.5);
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
