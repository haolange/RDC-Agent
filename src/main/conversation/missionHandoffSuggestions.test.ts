import { describe, expect, it } from 'vitest';
import type { ConversationToolCall, ConversationWorkTrace } from '@shared/types/conversation';
import { shouldSnapshotHandoffSuggestions } from './missionHandoffSuggestions';

const approvedCall = {
  id: 'call',
  toolName: 'plan_artifact',
  status: 'complete',
  startedAt: 1,
  planReview: { status: 'approved' },
} as ConversationToolCall;

function traceWith(calls: ConversationToolCall[]): ConversationWorkTrace {
  return {
    status: 'complete',
    updatedAt: 1,
    blocks: [{
      id: 'block',
      kind: 'plan_review',
      title: 'Plan',
      status: 'complete',
      startedAt: 1,
      toolCalls: calls,
    }],
  };
}

describe('shouldSnapshotHandoffSuggestions', () => {
  it('keeps General continue suggestions after a complete turn', () => {
    expect(shouldSnapshotHandoffSuggestions({
      agentId: 'general',
      finalStatus: 'complete',
    })).toBe(true);
  });

  it('does not dress a Mission prose plan with Execute suggestions', () => {
    expect(shouldSnapshotHandoffSuggestions({
      agentId: 'debugger',
      finalStatus: 'complete',
      workTrace: traceWith([]),
    })).toBe(false);
  });

  it('emits Mission suggestions only after an approved plan_artifact', () => {
    expect(shouldSnapshotHandoffSuggestions({
      agentId: 'analyzer',
      finalStatus: 'complete',
      workTrace: traceWith([approvedCall]),
    })).toBe(true);
  });

  it.each(['awaiting', 'rejected', 'superseded'] as const)('does not emit suggestions for a %s plan', (status) => {
    expect(shouldSnapshotHandoffSuggestions({
      agentId: 'optimizer',
      finalStatus: 'complete',
      workTrace: traceWith([{ ...approvedCall, planReview: { ...approvedCall.planReview!, status } }]),
    })).toBe(false);
  });

  it('never snapshots suggestions for an incomplete turn', () => {
    expect(shouldSnapshotHandoffSuggestions({
      agentId: 'general',
      finalStatus: 'streaming',
    })).toBe(false);
  });
});
