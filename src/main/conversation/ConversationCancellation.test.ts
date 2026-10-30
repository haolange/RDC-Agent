import { translate } from '../../renderer/i18n/messages';
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
    expect(createToolRowForPresentation(call, (key, params) => translate('zh-CN', key, params)).status).toBe(status);
  });
  it.each(['pending', 'running'] as const)('keeps a %s tool live when only its old permission approval is cancelled', status => {
    let trace = upsertRuntimeToolCall(undefined, { id: 'switch', toolName: 'shell', status, startedAt: 10,
      ...(status === 'running' ? { executionStartedAt: 20 } : {}) });
    const blockId = trace.blocks[0].id;
    trace = upsertRuntimeToolApproval(trace, { approvalId: 'old-approval', toolCallId: 'switch', toolName: 'shell', status: 'pending' });
    trace = upsertRuntimeToolApproval(trace, { approvalId: 'old-approval', toolCallId: 'switch', toolName: 'shell', status: 'cancelled', errorCode: 'PERMISSION_MODE_CHANGED', answer: 'PERMISSION_MODE_CHANGED' });
    let call = trace.blocks[0].toolCalls[0];
    expect(call).toMatchObject({ id: 'switch', status, approval: { approvalId: 'old-approval', status: 'cancelled', errorCode: 'PERMISSION_MODE_CHANGED' } });
    expect(call.completedAt).toBeUndefined(); expect(call.error).toBeUndefined();
    expect(createToolRowForPresentation(call, (key, params) => translate('en', key, params)).status).toBe(status);
    trace = upsertRuntimeToolCall(trace, { id: 'switch', toolName: 'shell', status: 'running', executionStartedAt: 30 });
    expect(trace.blocks[0].toolCalls[0].status).toBe('running');
    trace = upsertRuntimeToolCall(trace, { id: 'switch', toolName: 'shell', status: 'complete', completedAt: 40, resultPreview: 'node version', });
    call = trace.blocks[0].toolCalls[0];
    expect(trace.blocks[0].id).toBe(blockId); expect(call.status).toBe('complete');
    expect(call.approval?.status).toBe('cancelled'); expect(call.completedAt).toBe(40);
    expect(createToolRowForPresentation(call, (key, params) => translate('en', key, params)).status).toBe('complete');
  });

  it('does not merge a superseded approval cancellation into the next unique request', () => {
    let trace = upsertRuntimeToolApproval(undefined, { approvalId: 'old', toolCallId: 'switch', toolName: 'shell', status: 'cancelled', errorCode: 'PERMISSION_MODE_CHANGED', answer: 'old cancellation' });
    trace = upsertRuntimeToolApproval(trace, { approvalId: 'new', toolCallId: 'switch', toolName: 'shell', status: 'pending' });
    const call = trace.blocks[0].toolCalls[0];
    expect(call.status).toBe('pending');
    expect(call.approval).toMatchObject({ approvalId: 'new', status: 'pending' });
    expect(call.approval?.errorCode).toBeUndefined(); expect(call.approval?.resolvedAt).toBeUndefined();
    expect(call.approval?.answer).toBeUndefined();
  });

  it.each(['pending', 'running'] as const)('keeps actual Stop terminal after a %s permission approval was superseded', status => {
    let trace = upsertRuntimeToolCall(undefined, { id: 'stop', toolName: 'shell', status, startedAt: 10 });
    trace = upsertRuntimeToolApproval(trace, { approvalId: 'old', toolCallId: 'stop', toolName: 'shell', status: 'cancelled', errorCode: 'PERMISSION_MODE_CHANGED' });
    trace = finalizeTrace(trace, 'stopped', undefined, 50);
    const expected = status === 'pending' ? 'skipped' : 'cancelled';
    expect(trace.blocks[0].toolCalls[0]).toMatchObject({ status: expected, completedAt: 50 });
    expect(upsertRuntimeToolCall(trace, { id: 'stop', toolName: 'shell', status: 'running', executionStartedAt: 60 })).toEqual(trace);
    expect(upsertRuntimeToolCall(trace, { id: 'stop', toolName: 'shell', status: 'complete', completedAt: 70 })).toEqual(trace);
    expect(upsertRuntimeToolApproval(trace, { approvalId: 'late', toolCallId: 'stop', toolName: 'shell', status: 'cancelled', errorCode: 'PERMISSION_MODE_CHANGED' })).toEqual(trace);
  });

});
