/** Hex / RGB helpers for theme chrome compilation. */

const HEX_RE = /^#([0-9a-fA-F]{6})$/;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export interface Hsv {
  h: number;
  s: number;
  v: number;
}

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value.trim());
}

export function normalizeHexColor(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!isHexColor(trimmed)) {
    return isHexColor(fallback) ? fallback.toLowerCase() : '#33d1ff';
  }
  return trimmed.toLowerCase();
}

export function hexToRgb(hex: string): Rgb {
  const normalized = normalizeHexColor(hex, '#000000');
  const raw = normalized.slice(1);
  return {
    r: Number.parseInt(raw.slice(0, 2), 16),
    g: Number.parseInt(raw.slice(2, 4), 16),
    b: Number.parseInt(raw.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')}`;
}

export function rgbToCssTriplet({ r, g, b }: Rgb): string {
  return `${Math.round(r)} ${Math.round(g)} ${Math.round(b)}`;
}

export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const luminanceA = relativeLuminance(a);
  const luminanceB = relativeLuminance(b);
  return (Math.max(luminanceA, luminanceB) + 0.05) / (Math.min(luminanceA, luminanceB) + 0.05);
}

const NEAR_BLACK: Rgb = { r: 12, g: 16, b: 22 };
const NEAR_WHITE: Rgb = { r: 248, g: 251, b: 255 };
/** Luminance at which near-black and near-white read equally well. */
const INK_FLIP_LUMINANCE = 0.18;

/**
 * The same hue moved away from the given backgrounds (darker on light surfaces, lighter on dark ones)
 * just far enough to read at `minRatio` on every one of them.
 */
export function readableOn(color: Rgb, backgrounds: readonly Rgb[], minRatio = 4.5): Rgb {
  const worstRatio = (candidate: Rgb) => Math.min(...backgrounds.map((background) => contrastRatio(candidate, background)));
  if (worstRatio(color) >= minRatio) return color;
  const meanLuminance = backgrounds.reduce((sum, background) => sum + relativeLuminance(background), 0) / backgrounds.length;
  const direction = meanLuminance > INK_FLIP_LUMINANCE ? -1 : 1;
  const hsl = rgbToHsl(color);
  for (let lightness = hsl.l + direction; lightness >= 0 && lightness <= 100; lightness += direction) {
    // Judge the color CSS will actually paint: the compiler emits whole channel values.
    const { r, g, b } = hslToRgb({ ...hsl, l: lightness });
    const candidate = { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
    if (worstRatio(candidate) >= minRatio) return candidate;
  }
  return direction < 0 ? NEAR_BLACK : NEAR_WHITE;
}

/** Near-black or near-white, whichever reads better as text or icons on a filled `background`. */
export function inkOn(background: Rgb): Rgb {
  return contrastRatio(NEAR_BLACK, background) >= contrastRatio(NEAR_WHITE, background) ? NEAR_BLACK : NEAR_WHITE;
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return { h, s: s * 100, l: l * 100 };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;
  let rn = 0;
  let gn = 0;
  let bn = 0;
  if (h < 60) [rn, gn, bn] = [c, x, 0];
  else if (h < 120) [rn, gn, bn] = [x, c, 0];
  else if (h < 180) [rn, gn, bn] = [0, c, x];
  else if (h < 240) [rn, gn, bn] = [0, x, c];
  else if (h < 300) [rn, gn, bn] = [x, 0, c];
  else [rn, gn, bn] = [c, 0, x];
  return {
    r: (rn + m) * 255,
    g: (gn + m) * 255,
    b: (bn + m) * 255,
  };
}

/** HSV is the picker geometry: hue rail plus a saturation x value plane. */
export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return {
    h,
    s: (max === 0 ? 0 : delta / max) * 100,
    v: max * 100,
  };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const sn = s / 100;
  const vn = v / 100;
  const c = vn * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = vn - c;
  let rn = 0;
  let gn = 0;
  let bn = 0;
  if (h < 60) [rn, gn, bn] = [c, x, 0];
  else if (h < 120) [rn, gn, bn] = [x, c, 0];
  else if (h < 180) [rn, gn, bn] = [0, c, x];
  else if (h < 240) [rn, gn, bn] = [0, x, c];
  else if (h < 300) [rn, gn, bn] = [x, 0, c];
  else [rn, gn, bn] = [c, 0, x];
  return {
    r: (rn + m) * 255,
    g: (gn + m) * 255,
    b: (bn + m) * 255,
  };
}

export function hexToHsv(hex: string): Hsv {
  return rgbToHsv(hexToRgb(hex));
}

export function hsvToHex(hsv: Hsv): string {
  return rgbToHex(hsvToRgb(hsv));
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.max(0, Math.min(1, t));
  return {
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k,
  };
}

/** Adjust ink/surface separation around a contrast slider (0–100, default 45). */
export function applyContrastPair(
  surface: Rgb,
  ink: Rgb,
  contrast: number,
  variant: 'dark' | 'light',
): { surface: Rgb; ink: Rgb } {
  const clamped = Math.max(0, Math.min(100, contrast));
  const delta = (clamped - 45) / 100;
  if (variant === 'dark') {
    return {
      surface: mixRgb(surface, { r: 0, g: 0, b: 0 }, Math.max(0, delta) * 0.35),
      ink: mixRgb(ink, { r: 255, g: 255, b: 255 }, Math.max(0, delta) * 0.45),
    };
  }
  return {
    surface: mixRgb(surface, { r: 255, g: 255, b: 255 }, Math.max(0, delta) * 0.35),
    ink: mixRgb(ink, { r: 0, g: 0, b: 0 }, Math.max(0, delta) * 0.45),
  };
}

export type AccentStep = '50' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';
export type SurfaceStep = '0' | '1' | '2' | '3' | '4' | '5';
export type InkStep = 'primary' | 'secondary' | 'tertiary' | 'muted' | 'disabled';

export function scaleAccentPalette(accent: Rgb): Record<AccentStep, Rgb> {
  const hsl = rgbToHsl(accent);
  const shade = (l: number, sMul = 1) =>
    hslToRgb({ h: hsl.h, s: Math.min(100, hsl.s * sMul), l });
  return {
    '50': shade(96, 0.35),
    '100': shade(92, 0.45),
    '200': shade(84, 0.6),
    '300': shade(72, 0.75),
    '400': shade(58, 0.9),
    '500': accent,
    '600': shade(Math.max(28, hsl.l - 12), 1.05),
    '700': shade(Math.max(22, hsl.l - 22), 1.05),
    '800': shade(Math.max(18, hsl.l - 32), 1),
    '900': shade(Math.max(14, hsl.l - 40), 0.95),
  };
}

export function scaleSurfacePalette(surface: Rgb, variant: 'dark' | 'light'): Record<SurfaceStep, Rgb> {
  if (variant === 'dark') {
    return {
      '0': mixRgb(surface, { r: 0, g: 0, b: 0 }, 0.35),
      '1': surface,
      '2': mixRgb(surface, { r: 255, g: 255, b: 255 }, 0.04),
      '3': mixRgb(surface, { r: 255, g: 255, b: 255 }, 0.08),
      '4': mixRgb(surface, { r: 255, g: 255, b: 255 }, 0.14),
      '5': mixRgb(surface, { r: 255, g: 255, b: 255 }, 0.22),
    };
  }
  return {
    '0': mixRgb(surface, { r: 220, g: 224, b: 230 }, 0.35),
    '1': surface,
    '2': mixRgb(surface, { r: 0, g: 0, b: 0 }, 0.04),
    '3': mixRgb(surface, { r: 0, g: 0, b: 0 }, 0.08),
    '4': mixRgb(surface, { r: 0, g: 0, b: 0 }, 0.14),
    '5': mixRgb(surface, { r: 0, g: 0, b: 0 }, 0.22),
  };
}

export function scaleInkPalette(ink: Rgb, variant: 'dark' | 'light'): Record<InkStep, Rgb> {
  if (variant === 'dark') {
    return {
      primary: ink,
      secondary: mixRgb(ink, { r: 0, g: 0, b: 0 }, 0.18),
      tertiary: mixRgb(ink, { r: 0, g: 0, b: 0 }, 0.24),
      muted: mixRgb(ink, { r: 0, g: 0, b: 0 }, 0.28),
      disabled: mixRgb(ink, { r: 0, g: 0, b: 0 }, 0.7),
    };
  }
  return {
    primary: ink,
    secondary: mixRgb(ink, { r: 255, g: 255, b: 255 }, 0.18),
    tertiary: mixRgb(ink, { r: 255, g: 255, b: 255 }, 0.22),
    muted: mixRgb(ink, { r: 255, g: 255, b: 255 }, 0.26),
    disabled: mixRgb(ink, { r: 255, g: 255, b: 255 }, 0.68),
  };
}
