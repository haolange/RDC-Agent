import { describe, expect, it, vi } from 'vitest';
import type { ConversationWorkTrace } from '@shared/types/conversation';
import { finalizeTrace, upsertLoopResult, upsertRuntimeToolCall } from './ConversationWorkTrace';

const finish = (trace: ConversationWorkTrace | undefined, id: string) => upsertLoopResult(
  trace, id, 'Progress update', undefined, undefined, 'complete', 'tool_use', 'commentary',
);

describe('work trace loop settlement and interaction ownership', () => {
  it('settles the screenshot sequence without ending the active turn', () => {
    let trace = finish(undefined, 'runtime-loop-15');
    trace = upsertRuntimeToolCall(trace, { id: 'plan-first', toolName: 'plan_artifact', status: 'complete' });
    trace = finish(trace, 'runtime-loop-16');
    trace = upsertRuntimeToolCall(trace, { id: 'read', toolName: 'artifact_read', status: 'complete' }, { loopId: 'runtime-loop-16' });
    expect(trace.blocks.filter((block) => block.kind === 'llm_turn').map((block) => block.status))
      .toEqual(['complete', 'complete']);
    expect(trace.status).toBe('running');
  });

  it.each(['plan_artifact', 'ask_user'])('keeps separate %s calls at their original positions', (toolName) => {
    let trace = finish(undefined, 'loop-1');
    trace = upsertRuntimeToolCall(trace, { id: 'first', toolName, status: 'complete' });
    trace = finish(trace, 'loop-2');
    trace = upsertRuntimeToolCall(trace, { id: 'second', toolName, status: 'running' });
    const interactions = trace.blocks.filter((block) => block.kind !== 'llm_turn');
    expect(interactions).toHaveLength(2);
    expect(interactions.map((block) => block.toolCalls.map((call) => call.id))).toEqual([['first'], ['second']]);
    expect(trace.blocks.map((block) => block.kind)).toEqual(['llm_turn', interactions[0].kind, 'llm_turn', interactions[1].kind]);
    const ids = trace.blocks.map((block) => block.id);
    trace = upsertRuntimeToolCall(trace, { id: 'second', toolName, status: 'complete' });
    expect(trace.blocks.map((block) => block.id)).toEqual(ids);
    expect(trace.blocks[1].status).toBe('complete');
    expect(trace.blocks[3].status).toBe('complete');
  });

  it.each(['pending', 'running'] as const)('waits for its own %s tool after model output ends', (status) => {
    let trace = upsertRuntimeToolCall(undefined, { id: 'read', toolName: 'artifact_read', status }, { loopId: 'loop' });
    trace = finish(trace, 'loop');
    expect(trace.blocks[0].status).toBe('running');
    expect(trace.blocks[0].completedAt).toBeUndefined();
    trace = upsertRuntimeToolCall(trace, { id: 'read', toolName: 'artifact_read', status: 'complete' }, { loopId: 'loop' });
    expect(trace.blocks[0].status).toBe('complete');
  });

  it('preserves tool errors when model output settles', () => {
    let trace = upsertRuntimeToolCall(undefined, { id: 'read', toolName: 'artifact_read', status: 'error', error: 'Missing artifact' }, { loopId: 'loop' });
    trace = finish(trace, 'loop');
    expect(trace.blocks[0].status).toBe('error');
    expect(trace.blocks[0].toolCalls[0].error).toBe('Missing artifact');
    expect(finalizeTrace(trace, 'stopped').status).toBe('stopped');
  });

  it('keeps the first settlement time and clears it on explicit streaming recovery', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100);
    try {
      let trace = finish(undefined, 'loop');
      expect(trace.blocks[0].completedAt).toBe(100);
      clock.mockReturnValue(200);
      trace = finish(trace, 'loop');
      expect(trace.blocks[0].completedAt).toBe(100);
      trace = upsertLoopResult(trace, 'loop', 'Progress update continues', undefined, undefined, 'streaming');
      expect(trace.blocks[0].status).toBe('running');
      expect(trace.blocks[0].completedAt).toBeUndefined();
      expect(trace.blocks[0].result?.outputPhase).toBeUndefined();
    } finally { clock.mockRestore(); }
  });

  it('does not reopen a completed parent because a background child remains active', () => {
    let trace = upsertRuntimeToolCall(undefined, { id: 'delegate', toolName: 'subagent', status: 'complete',
      delegation: { task: 'Background analysis', profile: 'general', mode: 'background', executionId: 'child' } }, { loopId: 'loop' });
    trace = finish(trace, 'loop');
    expect(trace.blocks[0].status).toBe('complete');
    expect(trace.status).toBe('running');
  });
});
