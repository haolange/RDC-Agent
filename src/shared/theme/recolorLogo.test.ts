import { describe, expect, it } from 'vitest';
import { recolorLogoRgba } from './recolorLogo';

describe('recolorLogoRgba', () => {
  it('moves a saturated green pixel onto the accent hue and leaves white alone', () => {
    const pixels = new Uint8Array([
      0, 220, 80, 255,
      255, 255, 255, 255,
    ]);
    recolorLogoRgba(pixels, '#cc3355');
    expect(pixels[0]).toBeGreaterThan(pixels[1]);
    expect([pixels[4], pixels[5], pixels[6], pixels[7]]).toEqual([255, 255, 255, 255]);
  });

  it('leaves a near-black pixel unchanged', () => {
    const pixels = new Uint8Array([4, 12, 8, 255]);
    recolorLogoRgba(pixels, '#33d1ff');
    expect(Array.from(pixels)).toEqual([4, 12, 8, 255]);
  });
});
