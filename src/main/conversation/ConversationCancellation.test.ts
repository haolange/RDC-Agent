import { describe, expect, it } from 'vitest';
import { finalizeTrace, upsertLoopResult, upsertRuntimeToolApproval, upsertRuntimeToolCall } from './ConversationWorkTrace';
import { createToolRowForPresentation } from '../../renderer/features/transcript/workProcessToolRows';
import { buildConversationToolCompletion } from './ConversationToolCompletion';
import { applyPlanReviewAnswered } from './ConversationPlanReviewEvents';
import { stopWorkTrace } from '../../renderer/lib/stopWorkTrace';
import type { ConversationMessage, ConversationWorkTrace } from '@shared/types/conversation';

const pendingTrace = (): ConversationWorkTrace => upsertRuntimeToolCall(undefined, {
  id: 'p', toolName: 'plan_artifact', status: 'running', startedAt: 10,
  planReview: { planId: 'plan', revision: 1, title: 'Plan', uri: 'session://plans/plan.md',
    hash: 'a'.repeat(64), summary: [], sections: [], status: 'awaiting', handoffOptions: [] },
});
describe('request cancellation is not rejection or failure', () => {
  it('settles the main trace and optimistic stop with the same cancelled semantics', () => {
    const trace = pendingTrace();
    const main = finalizeTrace(trace, 'stopped', undefined, 100);
    const optimistic = stopWorkTrace({ id: 'a', role: 'assistant', turnId: 'turn',
      createdAt: 1, content: '', status: 'streaming', workTrace: trace } as ConversationMessage);
    for (const result of [main, optimistic.workTrace!]) {
      const call = result.blocks[0].toolCalls[0];
      expect(result.status).toBe('stopped');
      expect(call.status).toBe('cancelled');
      expect(call.planReview?.status).toBe('cancelled');
      expect(call.planReview?.decision).toBeUndefined();
      expect(call.error).toBeUndefined();
      expect(result.blocks[0].status).toBe('cancelled');
    }
    expect(finalizeTrace(main, 'stopped', undefined, 200).blocks[0].toolCalls[0].completedAt).toBe(100);
  });
  it('keeps actual failures, completed results and unexecuted calls distinct', () => {
    let trace = pendingTrace();
    for (const [id, status] of [['failed', 'error'], ['done', 'complete'], ['queued', 'pending']] as const) {
      trace = upsertRuntimeToolCall(trace, { id, toolName: 'read_file', status, startedAt: 10,
        ...(status === 'error' ? { error: 'Disk read failed' } : {}) });
    }
    const calls = finalizeTrace(trace, 'stopped', undefined, 100).blocks.flatMap(block => block.toolCalls);
    expect(calls.find(call => call.id === 'failed')).toMatchObject({ status: 'error', error: 'Disk read failed' });
    expect(calls.find(call => call.id === 'done')?.status).toBe('complete');
    expect(calls.find(call => call.id === 'queued')?.status).toBe('skipped');
  });
  it('projects an explicit cancelled review without creating a user decision', () => {
    const trace = applyPlanReviewAnswered({ workTrace: pendingTrace(), payload: {
      toolCallId: 'p', status: 'cancelled', answer: 'Request cancelled' } });
    expect(trace?.blocks[0].toolCalls[0]).toMatchObject({ status: 'cancelled', planReview: { status: 'cancelled' } });
    expect(trace?.blocks[0].toolCalls[0].planReview?.decision).toBeUndefined();
    const cancelled = trace!.blocks[0].toolCalls[0];
    expect(buildConversationToolCompletion('p', 'plan_artifact', { ok: false, duration_ms: 0,
      error: { code: 'AGENT_TOOL_FAILED', message: 'Cancelled', category: 'execution' } }, cancelled, 300).status).toBe('cancelled');
  });
  it('does not reopen a stopped trace when a late result or tool update arrives', () => {
    const stopped = finalizeTrace(pendingTrace(), 'stopped', undefined, 100);
    expect(upsertLoopResult(stopped, 'loop', 'late', undefined, undefined, 'streaming')).toEqual(stopped);
    expect(upsertRuntimeToolCall(stopped, { id: 'p', toolName: 'plan_artifact', status: 'running' })).toEqual(stopped);
  });
  it.each(['complete', 'error'] as const)('keeps a real %s receipt when approval cancellation arrives late', status => {
    const trace = upsertRuntimeToolCall(undefined, { id: 'done', toolName: 'shell', status, startedAt: 1,
      completedAt: 2, ...(status === 'error' ? { error: 'actual failure' } : {}) });
    const next = upsertRuntimeToolApproval(trace, { approvalId: 'a', toolCallId: 'done', toolName: 'shell', status: 'cancelled' });
    const call = next.blocks[0].toolCalls[0];
    expect(call.status).toBe(status);
    expect(call.completedAt).toBe(2);
    expect(createToolRowForPresentation(call).status).toBe(status);
  });
});
