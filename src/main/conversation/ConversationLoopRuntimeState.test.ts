import { describe, expect, it } from 'vitest';
import type { ThinkingArtifact } from '@shared/types/reasoning';
import { beginAssistantContentLoopIfPending, type ConversationLoopRuntimeState } from './ConversationLoopRuntimeState';
import { upsertLoopResult, upsertRuntimeToolCall } from './ConversationWorkTrace';

const toolLoopThinking: ThinkingArtifact = {
  text: 'I should read memory before answering.',
  kind: 'summary',
  source: 'anthropic-thinking',
  visibility: 'summary',

};

const finalLoopThinking: ThinkingArtifact = {
  text: 'I have the memory results and can now answer.',
  kind: 'summary',
  source: 'anthropic-thinking',
  visibility: 'summary',

};

describe('conversation loop runtime state', () => {
  it('keeps tool events on the tool loop and moves post-tool thinking to the next loop', () => {
    let state: ConversationLoopRuntimeState = {
      loopSeq: 1,
      currentLoopText: 'Need memory before answering.',
      currentLoopThinking: toolLoopThinking,
      currentLoopThinkingStatus: 'complete',
      loopHasTools: true,
      pendingNewLoop: true,
      visibleResponse: '',
    };
    let trace = upsertLoopResult(
      undefined,
      'runtime-loop-1',
      state.currentLoopText,
      state.currentLoopThinking,
      state.currentLoopThinkingStatus,
      'complete',
      'tool_use',
      'commentary',
      'summary',
    );

    trace = upsertRuntimeToolCall(trace, {
      id: 'tool-memory',
      toolName: 'memory_read',
      status: 'complete',
      argsPreview: JSON.stringify({ name: 'project-identity' }),
      completedAt: 200,
    }, {
      loopId: `runtime-loop-${state.loopSeq}`,
      loopResultText: state.currentLoopText,
      loopThinking: state.currentLoopThinking,
      loopThinkingStatus: state.currentLoopThinkingStatus,
    });

    state = beginAssistantContentLoopIfPending(state);
    expect(state).toMatchObject({
      loopSeq: 2,
      currentLoopText: '',
      currentLoopThinking: undefined,
      currentLoopThinkingStatus: undefined,
      loopHasTools: false,
      pendingNewLoop: false,
      visibleResponse: '',
    });

    state.currentLoopThinking = finalLoopThinking;
    state.currentLoopThinkingStatus = 'streaming';
    trace = upsertLoopResult(
      trace,
      `runtime-loop-${state.loopSeq}`,
      undefined,
      state.currentLoopThinking,
      state.currentLoopThinkingStatus,
      'streaming',
    );

    expect(trace.blocks.map((block) => block.id)).toEqual(['runtime-loop-1', 'runtime-loop-2']);
    expect(trace.blocks[0]).toMatchObject({
      id: 'runtime-loop-1',
      thinking: { text: toolLoopThinking.text },
      toolCalls: [{ id: 'tool-memory', toolName: 'memory_read', status: 'complete' }],
    });
    expect(trace.blocks[1]).toMatchObject({
      id: 'runtime-loop-2',
      thinking: { text: finalLoopThinking.text },
      thinkingStatus: 'streaming',
      toolCalls: [],
    });
    expect(JSON.stringify(trace.blocks[0])).not.toContain(finalLoopThinking.text);
  });

  it('starts a fresh loop after ask_user pause when pendingNewLoop is set', () => {
    let state: ConversationLoopRuntimeState = {
      loopSeq: 1,
      currentLoopText: 'Need a few answers first.',
      currentLoopThinking: toolLoopThinking,
      currentLoopThinkingStatus: 'complete',
      loopHasTools: false,
      // ask_user is not loop-scoped, but ConversationService sets this on pause complete.
      pendingNewLoop: true,
      visibleResponse: '',
    };
    let trace = upsertLoopResult(
      undefined,
      'runtime-loop-1',
      state.currentLoopText,
      state.currentLoopThinking,
      state.currentLoopThinkingStatus,
      'complete',
      'end_turn',
      'commentary',
      'summary',
    );

    state = beginAssistantContentLoopIfPending(state);
    expect(state).toMatchObject({
      loopSeq: 2,
      currentLoopText: '',
      pendingNewLoop: false,
      visibleResponse: '',
    });

    state.currentLoopText = 'Thanks — here is the final answer.';
    trace = upsertLoopResult(
      trace,
      `runtime-loop-${state.loopSeq}`,
      state.currentLoopText,
      undefined,
      undefined,
      'complete',
      'end_turn',
      'final_answer',
      'none',
    );

    expect(trace.blocks.map((block) => block.id)).toEqual(['runtime-loop-1', 'runtime-loop-2']);
    expect(trace.blocks[0]).toMatchObject({
      id: 'runtime-loop-1',
      result: expect.objectContaining({ text: 'Need a few answers first.', outputPhase: 'commentary' }),
    });
    expect(trace.blocks[1]).toMatchObject({
      id: 'runtime-loop-2',
      result: expect.objectContaining({
        text: 'Thanks — here is the final answer.',
        outputPhase: 'final_answer',
      }),
    });
  });

  it('clears stale outputPhase when streaming resumes on the same loop without an explicit phase', () => {
    let trace = upsertLoopResult(
      undefined,
      'runtime-loop-1',
      'Ask commentary before questions.',
      undefined,
      undefined,
      'complete',
      'tool_use',
      'commentary',
      'none',
    );
    expect(trace.blocks[0]?.result?.outputPhase).toBe('commentary');

    trace = upsertLoopResult(
      trace,
      'runtime-loop-1',
      'Ask commentary before questions. Final answer after answers.',
      undefined,
      undefined,
      'streaming',
    );
    expect(trace.blocks[0]?.result?.outputPhase).toBeUndefined();
    expect(trace.blocks[0]?.result?.stopReason).toBeUndefined();
    expect(trace.blocks[0]?.result?.status).toBe('streaming');
  });
});
