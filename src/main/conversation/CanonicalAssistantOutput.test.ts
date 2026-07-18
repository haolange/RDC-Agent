import { describe, expect, it } from 'vitest';
import {
  EMPTY_CANONICAL_ASSISTANT_OUTPUT,
  reduceCanonicalAssistantOutput,
  requireCanonicalFinalAnswer,
} from './CanonicalAssistantOutput';

describe('canonical assistant output', () => {
  it('accepts final-only output without synthesizing another channel', () => {
    const state = reduceCanonicalAssistantOutput(
      EMPTY_CANONICAL_ASSISTANT_OUTPUT,
      'Final answer',
      'final_answer',
    );
    expect(requireCanonicalFinalAnswer(state)).toBe('Final answer');
  });

  it('never promotes commentary to final answer', () => {
    const state = reduceCanonicalAssistantOutput(
      EMPTY_CANONICAL_ASSISTANT_OUTPUT,
      'Progress update',
      'commentary',
    );
    expect(state.finalAnswerText).toBe('');
    expect(() => requireCanonicalFinalAnswer(state)).toThrow('PROVIDER_STREAM_MISSING_FINAL_ANSWER');
  });

  it('uses explicit phases even when commentary and final bytes are identical', () => {
    const commentary = reduceCanonicalAssistantOutput(
      EMPTY_CANONICAL_ASSISTANT_OUTPUT,
      'Same bytes',
      'commentary',
    );
    const final = reduceCanonicalAssistantOutput(commentary, 'Same bytes', 'final_answer');
    expect(requireCanonicalFinalAnswer(final)).toBe('Same bytes');
  });

  it('fails closed when the provider completes without canonical final output', () => {
    expect(() => requireCanonicalFinalAnswer(EMPTY_CANONICAL_ASSISTANT_OUTPUT))
      .toThrow('PROVIDER_STREAM_MISSING_FINAL_ANSWER');
  });
});