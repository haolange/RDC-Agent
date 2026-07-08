import { describe, expect, it } from 'vitest';
import type { ThinkingArtifact } from '@shared/types/reasoning';
import { beginAssistantContentLoopIfPending, type ConversationLoopRuntimeState } from './ConversationLoopRuntimeState';
import { upsertLoopResult, upsertRuntimeToolCall } from './ConversationWorkTrace';

const toolLoopThinking: ThinkingArtifact = {
  text: 'I should read memory before answering.',
  kind: 'summary',
  source: 'anthropic-thinking',
  visibility: 'summary',
  replayPolicy: 'provider-artifact',
};

const finalLoopThinking: ThinkingArtifact = {
  text: 'I have the memory results and can now answer.',
  kind: 'summary',
  source: 'anthropic-thinking',
  visibility: 'summary',
  replayPolicy: 'provider-artifact',
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
});
