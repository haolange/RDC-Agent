import { describe, expect, it } from 'vitest';
import type { ConversationWorkTrace } from '@shared/types/conversation';
import type { ToolResultMessage } from '../agent-runtime/core/types';
import { reconcileTerminalToolReceipts } from './ConversationTerminalToolReceipts';
import { finalizeTrace } from './ConversationWorkTrace';

const trace = (): ConversationWorkTrace => ({
  status: 'running', updatedAt: 100, blocks: [{
    id: 'loop', kind: 'llm_turn', title: 'Loop', status: 'running', startedAt: 100,
    toolCalls: [{ id: 'call-a', toolName: 'shell', status: 'running', startedAt: 110, argsPreview: 'wait' }],
  }],
});
const receipt = (patch: Partial<ToolResultMessage> = {}): ToolResultMessage => ({
  role: 'toolResult', toolCallId: 'call-a', toolName: 'shell', timestamp: 150,
  isError: true, content: [{ type: 'text', text: '[aborted]\nworking directory was not updated.' }],
  details: { reason: 'abort', exitCode: 1, durationMs: 40, truncated: false }, ...patch,
});

describe('stopped turn canonical tool receipts', () => {
  it('retains the actual abort receipt instead of the no-receipt placeholder', () => {
    const source = trace();
    const stopped = finalizeTrace(reconcileTerminalToolReceipts(source, [receipt()], 100), 'stopped');
    const tool = stopped.blocks[0].toolCalls[0];
    expect(stopped.status).toBe('stopped');
    expect(tool).toMatchObject({ status: 'error', completedAt: 150, error: '[aborted]\nworking directory was not updated.' });
    const preview = JSON.parse(tool.resultPreview!);
    expect(preview.ok).toBe(false);
    expect(JSON.stringify(preview)).toContain('abort');
    expect(tool.error).not.toContain('Run ended before');
    expect(source.blocks[0].toolCalls[0].status).toBe('running');
  });

  it('preserves a completed tool result while the conversation itself stays stopped', () => {
    const stopped = finalizeTrace(reconcileTerminalToolReceipts(trace(), [receipt({
      isError: false, content: [{ type: 'text', text: 'completed output' }],
      details: { ref: 'session://tool-outputs/result.json' },
    })], 100), 'stopped');
    expect(stopped.status).toBe('stopped');
    const tool = stopped.blocks[0].toolCalls[0];
    expect(tool.status).toBe('complete');
    expect(tool.resultPreview).toContain('completed output');
    expect(tool.resourceRefs?.map((ref) => ref.path)).toContain('session://tool-outputs/result.json');
  });

  it('retains main-owned image preview references from an actual successful result', () => {
    const result = reconcileTerminalToolReceipts(trace(), [receipt({ isError: false,
      details: { imagePreviews: [{ previewId: 'preview-a', fileName: 'plot.png', mimeType: 'image/png' }] },
    })], 100);
    expect(result?.blocks[0].toolCalls[0].imagePreviews).toEqual([
      { previewId: 'preview-a', fileName: 'plot.png', mimeType: 'image/png', width: undefined, height: undefined },
    ]);
  });

  it('uses the normal delegation projection and preview redaction without settling the child Task', () => {
    const source = trace(); const call = source.blocks[0].toolCalls[0];
    call.toolName = 'subagent';
    call.delegation = { task: 'Review data', profile: 'skeptic', mode: 'wait' };
    const secretLikeFixture = `sk-${'A'.repeat(40)}`;
    const result = reconcileTerminalToolReceipts(source, [receipt({ toolName: 'subagent', isError: false,
      content: [{ type: 'text', text: secretLikeFixture }],
      details: { profile: 'skeptic', executionId: 'execution-a', generation: 2 },
    })], 100);
    const projected = result?.blocks[0].toolCalls[0];
    expect(projected?.delegation).toEqual({ task: 'Review data', profile: 'skeptic', mode: 'wait', executionId: 'execution-a', generation: 2 });
    expect(projected?.resultPreview).not.toContain(secretLikeFixture);
    expect(call.delegation.executionId).toBeUndefined();
  });

  it.each(['ask_user', 'plan_artifact'])('preserves the existing answer projection for %s', (toolName) => {
    const source = trace(); const call = source.blocks[0].toolCalls[0];
    call.toolName = toolName; call.resultPreview = 'Already projected human answer';
    const result = reconcileTerminalToolReceipts(source, [receipt({ toolName, isError: false,
      content: [{ type: 'text', text: 'Runtime acknowledgement only' }],
    })], 100);
    expect(result?.blocks[0].toolCalls[0].resultPreview).toBe('Already projected human answer');
  });

  it.each([
    { toolCallId: 'foreign-call' }, { toolName: 'foreign-tool' }, { timestamp: 99 },
    { timestamp: 105 }, { timestamp: Number.NaN },
  ])('rejects unowned, old or invalid receipts %j', (patch) => {
    const source = trace();
    expect(reconcileTerminalToolReceipts(source, [receipt(patch)], 100)).toBe(source);
  });

  it('does not overwrite an already observed terminal tool result', () => {
    const source = trace();
    Object.assign(source.blocks[0].toolCalls[0], { status: 'complete', resultPreview: 'observed', completedAt: 140 });
    expect(reconcileTerminalToolReceipts(source, [receipt()], 100)).toBe(source);
  });

  it.each([99, Number.NaN])('rejects a tool row with an invalid owning start %j', (startedAt) => {
    const source = trace(); source.blocks[0].toolCalls[0].startedAt = startedAt;
    expect(reconcileTerminalToolReceipts(source, [receipt()], 100)).toBe(source);
  });

  it('requires a valid turn start', () => {
    const source = trace();
    expect(reconcileTerminalToolReceipts(source, [receipt()], Number.NaN)).toBe(source);
  });

  it('does not invent results when no receipt exists or no tool was recorded', () => {
    const source = trace();
    expect(reconcileTerminalToolReceipts(source, [], 100)).toBe(source);
    expect(reconcileTerminalToolReceipts(undefined, [receipt()], 100)).toBeUndefined();
    expect(reconcileTerminalToolReceipts(null, [receipt()], 100)).toBeNull();
    const stopped = finalizeTrace(source, 'stopped');
    expect(stopped.blocks[0].toolCalls[0]).toMatchObject({ status: 'error', error: 'Run ended before this tool call completed.' });
  });
});
