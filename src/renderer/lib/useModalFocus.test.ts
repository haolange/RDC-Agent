import { describe, expect, it } from 'vitest';
import { shouldCaptureEscapedFocus } from './useModalFocus';

describe('shouldCaptureEscapedFocus', () => {
  it('lets a nested sibling dialog keep initial focus when the outer trap is off', () => {
    expect(shouldCaptureEscapedFocus(true)).toBe(true);
    expect(shouldCaptureEscapedFocus(false)).toBe(false);
  });
});
