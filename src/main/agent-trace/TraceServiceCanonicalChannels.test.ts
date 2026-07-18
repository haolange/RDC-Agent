import { describe, expect, it } from 'vitest';
import type { ConversationMessage, ConversationWorkBlock } from '@shared/types/conversation';
import { findCanonicalFinalAnswer } from './TraceService';

function block(id: string, text: string, outputPhase: 'commentary' | 'final_answer'): ConversationWorkBlock {
  return {
    id,
    kind: 'llm_turn',
    title: 'LLM turn',
    status: 'complete',
    result: {
      text,
      status: 'complete',
      stopReason: 'end_turn',
      outputPhase,
      toolCallIds: [],
    },
    toolCalls: [],
    startedAt: 1,
    completedAt: 2,
  };
}

function assistant(content: string, blocks: ConversationWorkBlock[]): ConversationMessage {
  return {
    id: 'assistant-1',
    turnId: 'turn-1',
    sessionId: 'session-1',
    projectId: 'project-1',
    runId: 'run-1',
    role: 'assistant',
    content,
    workTrace: { status: 'complete', blocks, updatedAt: 2 },
    createdAt: 1,
  };
}

describe('TraceService canonical channel reload', () => {
  it('does not rebuild final_response from untyped assistant text', () => {
    expect(findCanonicalFinalAnswer([assistant('legacy copied text', [])], 'run-1')).toBeNull();
  });

  it('reads only the explicit final_answer block after commentary and tools', () => {
    const commentary = block('loop-1', 'Working update', 'commentary');
    commentary.toolCalls.push({ id: 'tool-1', toolName: 'read_file', status: 'complete', startedAt: 1 });
    const final = block('loop-2', 'Canonical final', 'final_answer');
    expect(findCanonicalFinalAnswer([
      assistant('Canonical final', [commentary, final]),
    ], 'run-1')).toBe('Canonical final');
  });

  it('does not use text comparison when explicit commentary and final bytes match', () => {
    expect(findCanonicalFinalAnswer([
      assistant('Same bytes', [
        block('loop-1', 'Same bytes', 'commentary'),
        block('loop-2', 'Same bytes', 'final_answer'),
      ]),
    ], 'run-1')).toBe('Same bytes');
  });
});