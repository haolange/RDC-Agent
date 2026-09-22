import { describe, expect, it } from 'vitest';
import { maskLogoCircleRgba, recolorLogoRgba } from './recolorLogo';

describe('product logo pixels', () => {
  it.each(['#cc7d5e', '#33d1ff', '#8b44bb'])('matches the complete accent %s in lit ink', (accent) => {
    const pixels = new Uint8Array([0, 220, 80, 255, 0, 255, 240, 255]);
    recolorLogoRgba(pixels, accent);
    const expected = [1, 3, 5].map(i => parseInt(accent.slice(i, i + 2), 16));
    expect([...pixels]).toEqual([...expected, 255, ...expected, 255]);
  });
  it('preserves neutrals, near-black, other hues and transparent pixels', () => {
    const pixels = new Uint8Array([255, 255, 255, 255, 4, 12, 8, 255, 110, 110, 110, 255, 200, 20, 20, 255, 0, 255, 0, 0]);
    const original = pixels.slice(); recolorLogoRgba(pixels, '#cc7d5e');
    expect(pixels).toEqual(original);
  });
  it('mixes shadows with black and highlights with white without inherited hue', () => {
    const pixels = new Uint8Array([0, 110, 40, 255, 110, 220, 150, 255]);
    recolorLogoRgba(pixels, '#cc7d5e');
    expect([...pixels]).toEqual([102, 63, 47, 255, 230, 190, 175, 255]);
  });
  it('retains the center and circle ring, clears corners and antialiases the edge', () => {
    const pixels = new Uint8Array(100 * 100 * 4).fill(255);
    maskLogoCircleRgba(pixels, 100, 100);
    expect([...pixels.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect(pixels[(50 * 100 + 50) * 4 + 3]).toBe(255);
    expect(pixels[(50 * 100 + 2) * 4 + 3]).toBe(255);
    expect(pixels.some((v, i) => i % 4 === 3 && v > 0 && v < 255)).toBe(true);
  });
});
