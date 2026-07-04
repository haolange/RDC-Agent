import { describe, expect, it } from 'vitest';
import { finalizeTrace, upsertRuntimeToolApproval, upsertRuntimeToolCall } from './ConversationWorkTrace';

describe('ConversationService work trace tool approvals', () => {
  it('nests approval.requested and approval.answered under the matching tool call', () => {
    let trace = upsertRuntimeToolCall(undefined, {
      id: 'tool-web-search',
      toolName: 'web_search',
      status: 'pending',
      argsPreview: JSON.stringify({ query: 'latest Claude news' }),
      startedAt: 100,
    });

    trace = upsertRuntimeToolApproval(trace, {
      approvalId: 'tool-approval-tool-web-search',
      toolCallId: 'tool-web-search',
      toolName: 'web_search',
      status: 'pending',
      reason: 'Network tool "web_search" requires approval in the current permission mode.',
      risk: 'medium',
      reviewer: 'auto_review',
    });

    expect(trace.blocks).toHaveLength(1);
    expect(trace.blocks.some((block) => block.kind === 'approval')).toBe(false);
    const pendingCall = trace.blocks[0].toolCalls[0];
    expect(pendingCall).toMatchObject({
      id: 'tool-web-search',
      toolName: 'web_search',
      status: 'running',
      approval: {
        approvalId: 'tool-approval-tool-web-search',
        status: 'pending',
        reason: 'Network tool "web_search" requires approval in the current permission mode.',
        risk: 'medium',
        reviewer: 'auto_review',
      },
    });
    const requestedAt = pendingCall.approval?.requestedAt;
    expect(requestedAt).toEqual(expect.any(Number));

    trace = upsertRuntimeToolApproval(trace, {
      approvalId: 'tool-approval-tool-web-search',
      toolCallId: 'tool-web-search',
      toolName: 'web_search',
      status: 'approved',
      answer: 'Approved once',
    });

    const approvedCall = trace.blocks[0].toolCalls[0];
    expect(approvedCall.status).toBe('running');
    expect(approvedCall.approval).toMatchObject({
      status: 'approved',
      requestedAt,
      answer: 'Approved once',
    });
    expect(approvedCall.approval?.resolvedAt).toEqual(expect.any(Number));
  });

  it('marks rejected tool approval as the same tool row error', () => {
    const trace = upsertRuntimeToolApproval(undefined, {
      approvalId: 'tool-approval-tool-web-fetch',
      toolCallId: 'tool-web-fetch',
      toolName: 'web_fetch',
      status: 'rejected',
      reason: 'Network tool "web_fetch" requires approval in the current permission mode.',
      answer: 'User denied',
    });

    expect(trace.blocks).toHaveLength(1);
    expect(trace.blocks.some((block) => block.kind === 'approval')).toBe(false);
    expect(trace.blocks[0].toolCalls[0]).toMatchObject({
      id: 'tool-web-fetch',
      toolName: 'web_fetch',
      status: 'error',
      error: 'User denied',
      approval: { status: 'rejected', answer: 'User denied' },
    });
  });

  it('cancels pending tool approvals when the work trace is stopped', () => {
    let trace = upsertRuntimeToolCall(undefined, {
      id: 'tool-bash',
      toolName: 'bash',
      status: 'running',
      startedAt: 100,
    });
    trace = upsertRuntimeToolApproval(trace, {
      approvalId: 'tool-approval-tool-bash',
      toolCallId: 'tool-bash',
      toolName: 'bash',
      status: 'pending',
      reason: 'Run command?',
    });

    const stopped = finalizeTrace(trace, 'stopped', '请求已停止');

    expect(stopped.status).toBe('stopped');
    expect(stopped.blocks[0].toolCalls[0]).toMatchObject({
      status: 'error',
      approval: {
        status: 'cancelled',
        answer: '请求已取消。',
      },
    });
    expect(stopped.blocks[0].toolCalls[0].approval?.resolvedAt).toEqual(expect.any(Number));
  });

  it('does not regress a completed tool call when approval resolution arrives late', () => {
    let trace = upsertRuntimeToolCall(undefined, {
      id: 'tool-web-search',
      toolName: 'web_search',
      status: 'complete',
      completedAt: 200,
      resultPreview: JSON.stringify({ ok: true }),
    });

    trace = upsertRuntimeToolApproval(trace, {
      approvalId: 'tool-approval-tool-web-search',
      toolCallId: 'tool-web-search',
      toolName: 'web_search',
      status: 'approved',
      answer: 'Approved once',
    });

    expect(trace.blocks[0].toolCalls[0]).toMatchObject({
      status: 'complete',
      completedAt: 200,
      approval: { status: 'approved', answer: 'Approved once' },
    });
  });
});
