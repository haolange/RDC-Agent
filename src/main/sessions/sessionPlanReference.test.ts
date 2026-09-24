import { describe, expect, it } from 'vitest';
import type { ConversationMessage } from '@shared/types/conversation';
import { resolvePlanReference } from './sessionPlanReference';
const reference = { sessionId: 'parent', planId: 'p', revision: 2, uri: 'session://plans/plan-frozen.md', expectedHash: 'a'.repeat(64) };
const message = { role: 'assistant', agentId: 'debugger', turnId: 'turn', workTrace: { blocks: [{ toolCalls: [{ id: 'call', toolName: 'plan_artifact', planReview: { planId: 'p', revision: 2, uri: reference.uri, hash: reference.expectedHash } }] }] } } as ConversationMessage;
describe('historical plan provenance', () => {
  it('uses the owning historical message and rejects unrecorded revisions', () => {
    expect(resolvePlanReference(reference, () => [message])).toMatchObject({ ownerSessionId: 'parent', agentId: 'debugger' });
    expect(() => resolvePlanReference({ ...reference, revision: 3 }, () => [message])).toThrow(/REFERENCE_DENIED/);
    expect(() => resolvePlanReference(reference, () => [message, message])).toThrow(/REFERENCE_DENIED/);
    expect(() => resolvePlanReference(reference, () => [{ ...message, agentId: undefined }])).toThrow(/PROVENANCE_MISSING/);
  });
  it('resolves delegated content to the recorded child, not the viewing parent', () => {
    const parent = structuredClone(message);
    parent.workTrace!.blocks[0].toolCalls[0].delegatedRequest = { childSessionId: 'child', executionId: 'e', turnId: 'child-turn', toolCallId: 'c' };
    const child = { ...message, agentId: 'optimizer', turnId: 'child-turn' } as ConversationMessage;
    expect(resolvePlanReference(reference, id => id === 'parent' ? [parent] : [child])).toMatchObject({ ownerSessionId: 'child', agentId: 'optimizer' });
  });
});
