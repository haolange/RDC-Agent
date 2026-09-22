import { hexToRgb, rgbToHsl } from './color.ts';

/** Recolor cyan/green ink with the complete accent, shaded only with black/white. */
export function recolorLogoRgba(pixels: Uint8Array | Uint8ClampedArray, accentHex: string): void {
  const accent = hexToRgb(accentHex);
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;
    const rgb = { r: pixels[i], g: pixels[i + 1], b: pixels[i + 2] };
    const hsl = rgbToHsl(rgb);
    if (hsl.s < 18 || hsl.l < 8 || hsl.h < 70 || hsl.h > 200) continue;
    const maximum = Math.max(rgb.r, rgb.g, rgb.b);
    const white = Math.min(rgb.r, rgb.g, rgb.b) / maximum;
    // Fully lit source ink reaches the exact accent; dim ink mixes with black.
    const shade = Math.min(1, maximum / 220);
    pixels[i] = Math.round((accent.r * (1 - white) + 255 * white) * shade);
    pixels[i + 1] = Math.round((accent.g * (1 - white) + 255 * white) * shade);
    pixels[i + 2] = Math.round((accent.b * (1 - white) + 255 * white) * shade);
  }
}

/** Preserve the source ring with a one-pixel antialiased circular alpha edge. */
export function maskLogoCircleRgba(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number): void {
  const radius = Math.min(width, height) * 0.49;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const coverage = Math.max(0, Math.min(1, radius + 0.5 - Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2)));
      pixels[i + 3] = Math.round(pixels[i + 3] * coverage);
      if (pixels[i + 3] === 0) pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
    }
  }
}
