import { describe, expect, it } from 'vitest';
import { hexToHsv, hsvToHex, rgbToHsv, hsvToRgb } from './color';

describe('HSV picker geometry', () => {
  it('round-trips hex through the saturation/value plane', () => {
    for (const hex of ['#cc7d5e', '#33d1ff', '#2f81f7', '#000000', '#ffffff', '#7f7f7f']) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });

  it('maps the plane corners to the expected colors for a fixed hue', () => {
    const hue = hexToHsv('#33d1ff').h;
    // Top-right of the plane is the fully saturated, full-brightness hue, so it
    // is more vivid than the partly desaturated colour the hue was read from.
    expect(hsvToHex({ h: hue, s: 100, v: 100 })).toBe('#00c5ff');
    // Left edge is achromatic, bottom edge is black regardless of saturation.
    expect(hsvToHex({ h: hue, s: 0, v: 100 })).toBe('#ffffff');
    expect(hsvToHex({ h: hue, s: 100, v: 0 })).toBe('#000000');
    expect(hsvToHex({ h: hue, s: 0, v: 0 })).toBe('#000000');
  });

  it('moves along the plane when saturation or value changes', () => {
    const start = hexToHsv('#33d1ff');
    const lessSaturated = hsvToHex({ ...start, s: start.s / 2 });
    const darker = hsvToHex({ ...start, v: start.v / 2 });
    expect(lessSaturated).not.toBe('#33d1ff');
    expect(darker).not.toBe('#33d1ff');
    // Halving value halves every channel of a full-brightness color.
    expect(hexToHsv(darker).v).toBeCloseTo(start.v / 2, 0);
  });

  it('changes the hue rail independently of saturation and value', () => {
    const base = hexToHsv('#33d1ff');
    const shifted = hexToHsv(hsvToHex({ ...base, h: 20 }));
    expect(Math.round(shifted.h)).toBe(20);
    expect(shifted.s).toBeCloseTo(base.s, 0);
    expect(shifted.v).toBeCloseTo(base.v, 0);
  });

  it('reports an undefined hue as zero so callers can preserve the rail position', () => {
    expect(rgbToHsv({ r: 0, g: 0, b: 0 })).toEqual({ h: 0, s: 0, v: 0 });
    expect(rgbToHsv({ r: 255, g: 255, b: 255 })).toEqual({ h: 0, s: 0, v: 100 });
  });

  it('keeps hsv and rgb conversions consistent across the hue wheel', () => {
    for (let hue = 0; hue < 360; hue += 30) {
      const rgb = hsvToRgb({ h: hue, s: 80, v: 60 });
      const back = rgbToHsv(rgb);
      expect(back.h).toBeCloseTo(hue, 0);
      expect(back.s).toBeCloseTo(80, 0);
      expect(back.v).toBeCloseTo(60, 0);
    }
  });
});
