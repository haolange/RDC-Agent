import { describe, expect, it } from 'vitest';
import { loopFinalAnswerText, settleTextPhase } from './loopItems';
import type { ConversationWorkBlock } from '../types/conversation';

const text = (value: string, phase?: 'commentary' | 'final_answer', index = 0) => ({
  kind: 'text' as const,
  providerOutputRef: { protocol: 'test', providerBlockKey: `text:${index}`, contentIndex: index },
  text: value,
  phase,
  status: 'complete' as const,
  displayOrder: index + 1,
});
const loop = (
  items: ConversationWorkBlock['items'],
  outputPhase?: 'commentary' | 'final_answer',
): ConversationWorkBlock => ({
  id: 'loop',
  kind: 'llm_turn',
  title: 'LLM turn',
  status: 'complete',
  toolCalls: [],
  startedAt: 1,
  items,
  result: { status: 'complete', toolCallIds: [], ...(outputPhase ? { outputPhase } : {}) },
});

describe('loop items', () => {
  it('stamps a phase only from the provider or from how the loop ended', () => {
    expect(settleTextPhase('commentary', { stopReason: 'end_turn', outputPhase: 'final_answer' })).toBe('commentary');
    expect(settleTextPhase(undefined, { stopReason: 'end_turn', outputPhase: 'final_answer' })).toBe('final_answer');
    expect(settleTextPhase(undefined, { stopReason: 'tool_use', outputPhase: 'commentary' })).toBe('commentary');
    expect(settleTextPhase(undefined, { stopReason: 'max_tokens', outputPhase: 'commentary' })).toBeUndefined();
  });

  it('reads the answer only from final-phase text of a loop that settled as final', () => {
    const mixed = [text('Checking. ', 'commentary', 0), text('The answer.', 'final_answer', 1)];
    expect(loopFinalAnswerText(loop(mixed, 'final_answer'))).toBe('The answer.');
    expect(loopFinalAnswerText(loop(mixed, 'commentary'))).toBe('');
  });
});
