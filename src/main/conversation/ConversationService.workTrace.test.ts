import { describe, expect, it } from 'vitest';
import {
  finalizeTrace,
  sanitizeStoredWorkTrace,
  upsertWorkBlock,
  upsertRuntimeToolApproval,
  upsertRuntimeToolCall,
} from './ConversationWorkTrace';

describe('ConversationService work trace tool approvals', () => {
  it('preserves diagnostic severity only on diagnostic blocks', () => {
    const diagnosticTrace = {
      status: 'complete' as const,
      updatedAt: 100,
      blocks: [{
        id: 'route-warning',
        kind: 'diagnostic' as const,
        title: 'Tool calling unsupported',
        status: 'complete' as const,
        diagnosticSeverity: 'warning' as const,
        toolCalls: [],
        startedAt: 90,
        completedAt: 100,
      }],
    };

    expect(sanitizeStoredWorkTrace(diagnosticTrace)?.blocks[0].diagnosticSeverity).toBe('warning');
    expect(sanitizeStoredWorkTrace({
      ...diagnosticTrace,
      blocks: [{ ...diagnosticTrace.blocks[0], kind: 'reasoning' as const }],
    })).toBeNull();
  });

  it('preserves source refs and rejects a persisted cross-channel collision', () => {
    const thinkingRef = {
      protocol: 'anthropic-messages',
      responseId: 'msg-1',
      providerBlockKey: 'content:0',
      sourceIndex: 0,
      contentIndex: 0,
    };
    const textRef = {
      protocol: 'anthropic-messages',
      responseId: 'msg-1',
      providerBlockKey: 'content:1',
      sourceIndex: 1,
      contentIndex: 1,
    };
    const toolRef = {
      protocol: 'anthropic-messages',
      responseId: 'msg-1',
      providerBlockKey: 'content:2',
      sourceIndex: 2,
      itemId: 'tool-1',
      contentIndex: 2,
    };
    const trace = {
      status: 'complete' as const,
      updatedAt: 100,
      blocks: [{
        id: 'runtime-loop-1',
        kind: 'llm_turn' as const,
        title: 'LLM turn',
        status: 'complete' as const,
        thinking: {
          text: 'reasoning',
          kind: 'raw' as const,
          source: 'anthropic-thinking' as const,
          visibility: 'raw-collapsed' as const,

          providerOutputRef: thinkingRef,
        },
        result: {
          text: 'answer',
          status: 'complete' as const,
          outputPhase: 'final_answer' as const,
          providerOutputRefs: [textRef],
          toolCallIds: ['tool-1'],
        },
        toolCalls: [{
          id: 'tool-1',
          toolName: 'read_file',
          status: 'complete' as const,
          providerOutputRef: toolRef,
          startedAt: 90,
          completedAt: 100,
        }],
        startedAt: 80,
        completedAt: 100,
      }],
    };

    expect(sanitizeStoredWorkTrace(trace)).not.toBeNull();
    expect(sanitizeStoredWorkTrace({
      ...trace,
      blocks: [{
        ...trace.blocks[0],
        result: { ...trace.blocks[0].result, providerOutputRefs: [thinkingRef] },
      }],
    })).toBeNull();
  });

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
      id: 'tool-shell',
      toolName: 'shell',
      status: 'running',
      startedAt: 100,
    });
    trace = upsertRuntimeToolApproval(trace, {
      approvalId: 'tool-approval-tool-shell',
      toolCallId: 'tool-shell',
      toolName: 'shell',
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

  it('does not terminalize TaskRegistry lifecycle blocks when a turn completes', () => {
    const trace = upsertWorkBlock(undefined, 'task-1', {
      kind: 'command',
      title: 'Wait for QA',
      stage: 'task',
      status: 'pending',
      taskStatus: 'pending',
      toolCalls: [],
    });

    const completed = finalizeTrace(trace, 'complete', 'Reply completed');

    expect(completed.blocks[0]).toMatchObject({
      id: 'task-1',
      stage: 'task',
      status: 'pending',
      taskStatus: 'pending',
    });
    expect(completed.blocks[0].completedAt).toBeUndefined();
  });

  it('marks an unexecuted tool call as skipped when a run otherwise completes', () => {
    const trace = upsertRuntimeToolCall(undefined, {
      id: 'tool-pending',
      toolName: 'task_list',
      status: 'pending',
      startedAt: 100,
    });

    const completed = finalizeTrace(trace, 'complete', 'Reply completed');

    expect(completed.blocks[0].toolCalls[0]).toMatchObject({
      status: 'skipped',
      resultPreview: 'Run completed before this tool call executed.',
    });
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

  it('updates a tool call by id instead of duplicating it when the active loop advances', () => {
    let trace = upsertRuntimeToolCall(undefined, {
      id: 'tool-read-file',
      toolName: 'read_file',
      status: 'pending',
      argsPreview: JSON.stringify({ path: 'package.json' }),
      startedAt: 100,
    }, { loopId: 'runtime-loop-1' });

    trace = upsertRuntimeToolCall(trace, {
      id: 'tool-read-file',
      toolName: 'read_file',
      status: 'complete',
      resultPreview: JSON.stringify({ ok: true, lines: 20 }),
      completedAt: 200,
    }, { loopId: 'runtime-loop-2' });

    expect(trace.blocks).toHaveLength(1);
    expect(trace.blocks[0]).toMatchObject({ id: 'runtime-loop-1', status: 'complete' });
    expect(trace.blocks[0].toolCalls).toEqual([
      expect.objectContaining({
        id: 'tool-read-file',
        status: 'complete',
        resultPreview: JSON.stringify({ ok: true, lines: 20 }),
        completedAt: 200,
      }),
    ]);
  });
});
