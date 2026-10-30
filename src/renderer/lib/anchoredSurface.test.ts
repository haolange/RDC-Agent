import { describe, expect, it } from 'vitest';
import { placeAnchoredSurface } from './anchoredSurface';

describe('anchored surface boundaries', () => {
  const anchor = { left: 180, right: 220, top: 160, bottom: 190 };
  it('flips above a bottom-edge trigger', () => {
    const result = placeAnchoredSurface(anchor, { width: 100, height: 80 }, { width: 300, height: 200 });
    expect(result.placement).toBe('top');
    expect(result.top + result.height).toBeLessThan(anchor.top);
  });
  it('contains oversized content without negative coordinates', () => {
    const result = placeAnchoredSurface(anchor, { width: 800, height: 900 }, { width: 240, height: 200 });
    expect(result).toMatchObject({ left: 8, top: 8, width: 224, height: 184 });
  });
  it('aligns trailing edges when sufficient space exists', () => {
    const result = placeAnchoredSurface(anchor, { width: 100, height: 80 }, { width: 500, height: 500 }, 'end');
    expect(result.left + result.width).toBe(anchor.right);
    expect(result.top).toBe(anchor.bottom + 4);
  });
});
