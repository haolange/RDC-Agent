import { describe, expect, it } from 'vitest';
import { resolveConversationLoopOutputPhase } from './loopOutputPhase';

describe('resolveConversationLoopOutputPhase', () => {
  it('returns final_answer for end_turn without tools or pending continuation', () => {
    expect(resolveConversationLoopOutputPhase({
      stopReason: 'end_turn',
      loopHasTools: false,
    })).toBe('final_answer');
  });

  it('returns commentary for end_turn when the loop has tools', () => {
    expect(resolveConversationLoopOutputPhase({
      stopReason: 'end_turn',
      loopHasTools: true,
    })).toBe('commentary');
  });

  it('returns commentary for max_tokens stop reason', () => {
    expect(resolveConversationLoopOutputPhase({
      stopReason: 'max_tokens',
      loopHasTools: false,
    })).toBe('commentary');
  });

  it('returns commentary for refusal stop reason', () => {
    expect(resolveConversationLoopOutputPhase({
      stopReason: 'refusal',
      loopHasTools: false,
    })).toBe('commentary');
  });

  it('returns commentary for aborted stop reason', () => {
    expect(resolveConversationLoopOutputPhase({
      stopReason: 'aborted',
      loopHasTools: false,
    })).toBe('commentary');
  });

  it('returns commentary for end_turn when userInput continuation is pending', () => {
    expect(resolveConversationLoopOutputPhase({
      stopReason: 'end_turn',
      loopHasTools: false,
      hasPendingContinuation: { userInput: true },
    })).toBe('commentary');
  });
});
