import { describe, expect, it } from 'vitest';
import { resolveModalTrapRoot, shouldCaptureEscapedFocus } from './useModalFocus';

describe('resolveModalTrapRoot', () => {
  it('uses the nested root only when it belongs to the dialog', () => {
    const container = { contains: (node: unknown) => node === 'sheet' } as unknown as HTMLElement;
    expect(resolveModalTrapRoot(container, 'sheet' as unknown as HTMLElement)).toBe('sheet');
    expect(resolveModalTrapRoot(container, 'other' as unknown as HTMLElement)).toBe(container);
    expect(resolveModalTrapRoot(container, null)).toBe(container);
  });
});

describe('shouldCaptureEscapedFocus', () => {
  it('lets a nested sibling dialog keep initial focus when the outer trap is off', () => {
    expect(shouldCaptureEscapedFocus(true)).toBe(true);
    expect(shouldCaptureEscapedFocus(false)).toBe(false);
  });
});
