import { hexToRgb, hslToRgb, rgbToHsl } from './color.ts';

/** Neon green through cyan on the product mark. Neutrals and near-black stay. */
const HUE_MIN = 70;
const HUE_MAX = 200;
const MIN_SATURATION = 18;
const MIN_LIGHTNESS = 8;

/** Shift saturated cyan/green pixels onto the accent hue. Mutates RGBA bytes in place. */
export function recolorLogoRgba(pixels: Uint8Array | Uint8ClampedArray, accentHex: string): void {
  const accentHue = rgbToHsl(hexToRgb(accentHex)).h;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] === 0) continue;
    const hsl = rgbToHsl({ r: pixels[index], g: pixels[index + 1], b: pixels[index + 2] });
    if (hsl.s < MIN_SATURATION || hsl.l < MIN_LIGHTNESS) continue;
    if (hsl.h < HUE_MIN || hsl.h > HUE_MAX) continue;
    const next = hslToRgb({ h: accentHue, s: hsl.s, l: hsl.l });
    pixels[index] = Math.round(next.r);
    pixels[index + 1] = Math.round(next.g);
    pixels[index + 2] = Math.round(next.b);
  }
}
