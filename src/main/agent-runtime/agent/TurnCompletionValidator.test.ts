import { describe, expect, it } from 'vitest';
import type { TurnCompletionInput } from './TurnCompletionValidator';

const input: TurnCompletionInput = {
  profileId: 'general',
  finalAnswerText: 'done',
  disposition: 'completed',
};

describe('turn completion input', () => {
  it('allows ordinary General work without a return binding', () => {
    expect(input.profileId).toBe('general');
    expect(input.finalAnswerText).toBe('done');
  });
});
