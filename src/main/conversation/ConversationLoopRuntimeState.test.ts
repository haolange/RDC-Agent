import { describe, expect, it } from 'vitest';
import {
  upsertLoopResult,
  upsertLoopTextItem,
  upsertLoopThinkingItem,
  upsertRuntimeToolCall,
} from '../agent-runtime/workTrace/ConversationWorkTrace';
import { beginAssistantContentLoopIfPending, type ConversationLoopRuntimeState } from './ConversationLoopRuntimeState';
import type { ThinkingArtifact } from '@shared/types/reasoning';

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

const thinkingRef = (index: number) => ({
  protocol: 'test',
  providerBlockKey: `thinking:${index}`,
  contentIndex: index,
});
const textRef = (index: number) => ({ protocol: 'test', providerBlockKey: `text:${index}`, contentIndex: index });

describe('conversation loop runtime state', () => {
  it('keeps tool events on the tool loop and moves post-tool thinking to the next loop', () => {
    let state: ConversationLoopRuntimeState = {
      loopSeq: 1,
      currentLoopText: 'Need memory before answering.',
      loopHasTools: true,
      pendingNewLoop: true,
      visibleResponse: '',
    };
    let trace = upsertLoopResult(undefined, 'runtime-loop-1', {
      status: 'complete',
      stopReason: 'tool_use',
      outputPhase: 'commentary',
      reasoningState: 'summary',
    });
    trace = upsertLoopThinkingItem(trace, 'runtime-loop-1', thinkingRef(0), toolLoopThinking, 'complete');

    trace = upsertRuntimeToolCall(
      trace,
      {
        id: 'tool-memory',
        toolName: 'memory_read',
        status: 'complete',
        argsPreview: JSON.stringify({ name: 'project-identity' }),
        completedAt: 200,
      },
      {
        loopId: `runtime-loop-${state.loopSeq}`,
      },
    );

    state = beginAssistantContentLoopIfPending(state);
    expect(state).toMatchObject({
      loopSeq: 2,
      currentLoopText: '',
      loopHasTools: false,
      pendingNewLoop: false,
      visibleResponse: '',
    });

    trace = upsertLoopThinkingItem(
      trace,
      `runtime-loop-${state.loopSeq}`,
      thinkingRef(1),
      finalLoopThinking,
      'streaming',
    );

    expect(trace.blocks.map((block) => block.id)).toEqual(['runtime-loop-1', 'runtime-loop-2']);
    expect(trace.blocks[0]).toMatchObject({
      id: 'runtime-loop-1',
      items: [{ kind: 'thinking', thinking: { text: toolLoopThinking.text } }],
      toolCalls: [{ id: 'tool-memory', toolName: 'memory_read', status: 'complete' }],
    });
    expect(trace.blocks[1]).toMatchObject({
      id: 'runtime-loop-2',
      items: [{ kind: 'thinking', thinking: { text: finalLoopThinking.text }, status: 'streaming' }],
      toolCalls: [],
    });
    expect(JSON.stringify(trace.blocks[0])).not.toContain(finalLoopThinking.text);
  });

  it('starts a fresh loop after ask_user pause when pendingNewLoop is set', () => {
    let state: ConversationLoopRuntimeState = {
      loopSeq: 1,
      currentLoopText: 'Need a few answers first.',
      loopHasTools: false,
      // ask_user is not loop-scoped, but ConversationService sets this on pause complete.
      pendingNewLoop: true,
      visibleResponse: '',
    };
    let trace = upsertLoopTextItem(
      undefined,
      'runtime-loop-1',
      textRef(0),
      'Need a few answers first.',
      'commentary',
      'complete',
    );
    trace = upsertLoopResult(trace, 'runtime-loop-1', {
      status: 'complete',
      stopReason: 'end_turn',
      outputPhase: 'commentary',
      reasoningState: 'summary',
    });

    state = beginAssistantContentLoopIfPending(state);
    expect(state).toMatchObject({
      loopSeq: 2,
      currentLoopText: '',
      pendingNewLoop: false,
      visibleResponse: '',
    });

    trace = upsertLoopTextItem(
      trace,
      `runtime-loop-${state.loopSeq}`,
      textRef(1),
      'Thanks — here is the final answer.',
      'final_answer',
      'complete',
    );
    trace = upsertLoopResult(trace, `runtime-loop-${state.loopSeq}`, {
      status: 'complete',
      stopReason: 'end_turn',
      outputPhase: 'final_answer',
      reasoningState: 'none',
    });

    expect(trace.blocks.map((block) => block.id)).toEqual(['runtime-loop-1', 'runtime-loop-2']);
    expect(trace.blocks[0]).toMatchObject({
      id: 'runtime-loop-1',
      items: [{ kind: 'text', text: 'Need a few answers first.' }],
      result: expect.objectContaining({ outputPhase: 'commentary' }),
    });
    expect(trace.blocks[1]).toMatchObject({
      id: 'runtime-loop-2',
      items: [{ kind: 'text', text: 'Thanks — here is the final answer.' }],
      result: expect.objectContaining({ outputPhase: 'final_answer' }),
    });
  });

  it('clears stale outputPhase when streaming resumes on the same loop without an explicit phase', () => {
    let trace = upsertLoopResult(undefined, 'runtime-loop-1', {
      status: 'complete',
      stopReason: 'tool_use',
      outputPhase: 'commentary',
      reasoningState: 'none',
    });
    expect(trace.blocks[0]?.result?.outputPhase).toBe('commentary');

    trace = upsertLoopResult(trace, 'runtime-loop-1', { status: 'streaming' });
    expect(trace.blocks[0]?.result?.outputPhase).toBeUndefined();
    expect(trace.blocks[0]?.result?.stopReason).toBeUndefined();
    expect(trace.blocks[0]?.result?.status).toBe('streaming');
  });
});
