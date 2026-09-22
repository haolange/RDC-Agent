import { describe, expect, it } from 'vitest';
import { shouldSendComposerOnEnter } from './composerKeyboard';

describe('Composer Enter policy', () => {
  it.each([
    ['Enter', false, false, 13, true],
    ['Enter', true, false, 13, false],
    ['Enter', false, true, 13, false],
    ['Enter', false, false, 229, false],
    ['a', false, false, 65, false],
  ])('key=%s shift=%s composing=%s code=%s sends=%s', (key, shiftKey, isComposing, keyCode, expected) => {
    expect(shouldSendComposerOnEnter({ key, shiftKey, nativeEvent: { isComposing, keyCode } as KeyboardEvent })).toBe(expected);
  });
});
