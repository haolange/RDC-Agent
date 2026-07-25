import { describe, expect, it } from 'vitest';
import {
  applyContrastPair,
  hexToRgb,
  hslToRgb,
  isHexColor,
  mixRgb,
  normalizeHexColor,
  relativeLuminance,
  rgbToCssTriplet,
  rgbToHex,
  rgbToHsl,
  scaleAccentPalette,
  scaleInkPalette,
  scaleSurfacePalette,
} from './color';

describe('theme color helpers', () => {
  it('validates and normalizes hex colors', () => {
    expect(isHexColor('#33d1ff')).toBe(true);
    expect(isHexColor('nope')).toBe(false);
    expect(normalizeHexColor('#AABBCC', '#000000')).toBe('#aabbcc');
    expect(normalizeHexColor('bad', '#112233')).toBe('#112233');
    expect(normalizeHexColor('bad', 'also-bad')).toBe('#33d1ff');
  });

  it('converts between hex/rgb/hsl and luminance', () => {
    const rgb = hexToRgb('#ff0000');
    expect(rgb).toEqual({ r: 255, g: 0, b: 0 });
    expect(rgbToHex(rgb)).toBe('#ff0000');
    expect(rgbToCssTriplet(rgb)).toBe('255 0 0');
    expect(relativeLuminance(rgb)).toBeGreaterThan(0);
    const hsl = rgbToHsl(rgb);
    expect(hsl.h).toBeCloseTo(0, 0);
    expect(rgbToHex(hslToRgb({ h: 120, s: 100, l: 50 }))).toBe('#00ff00');
    expect(rgbToHex(hslToRgb({ h: 240, s: 100, l: 50 }))).toBe('#0000ff');
    expect(rgbToHex(hslToRgb({ h: 300, s: 100, l: 50 }))).toBe('#ff00ff');
  });

  it('mixes colors and applies contrast pairs', () => {
    const mixed = mixRgb({ r: 0, g: 0, b: 0 }, { r: 100, g: 0, b: 0 }, 0.5);
    expect(mixed.r).toBe(50);
    const dark = applyContrastPair(
      { r: 20, g: 20, b: 20 },
      { r: 200, g: 200, b: 200 },
      80,
      'dark',
    );
    expect(dark.surface.r).toBeLessThanOrEqual(20);
    const light = applyContrastPair(
      { r: 240, g: 240, b: 240 },
      { r: 20, g: 20, b: 20 },
      80,
      'light',
    );
    expect(light.surface.r).toBeGreaterThanOrEqual(240);
  });

  it('scales accent/surface/ink palettes', () => {
    const accent = scaleAccentPalette({ r: 50, g: 120, b: 200 });
    expect(accent['500']).toEqual({ r: 50, g: 120, b: 200 });
    expect(Object.keys(accent)).toContain('900');
    expect(scaleSurfacePalette({ r: 30, g: 30, b: 30 }, 'dark')['1']).toEqual({ r: 30, g: 30, b: 30 });
    expect(scaleSurfacePalette({ r: 240, g: 240, b: 240 }, 'light')['1']).toEqual({ r: 240, g: 240, b: 240 });
    expect(scaleInkPalette({ r: 220, g: 220, b: 220 }, 'dark').primary).toEqual({ r: 220, g: 220, b: 220 });
    expect(scaleInkPalette({ r: 20, g: 20, b: 20 }, 'light').muted).toBeDefined();
  });
});
