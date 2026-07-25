import { describe, expect, it } from 'vitest';
import { parseRdxThemeV1, serializeRdxThemeV1 } from './rdxThemeV1';

const chrome = {
  presetId: 'rdc' as const,
  accent: '#33d1ff',
  surface: '#101418',
  ink: '#e8eef5',
  contrast: 45,
  fonts: { ui: null, code: null },
};

describe('rdxThemeV1', () => {
  it('round-trips serialize/parse', () => {
    const encoded = serializeRdxThemeV1(chrome, 'dark');
    expect(encoded.startsWith('rdx-theme-v1:')).toBe(true);
    const parsed = parseRdxThemeV1(encoded, 'dark');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.payload.variant).toBe('dark');
      expect(parsed.chrome.accent).toBe('#33d1ff');
    }
  });

  it('rejects unsupported prefixes and bad payloads', () => {
    expect(parseRdxThemeV1('codex-theme-v1:{}').ok).toBe(false);
    expect(parseRdxThemeV1('nope').ok).toBe(false);
    expect(parseRdxThemeV1('rdx-theme-v1:{').ok).toBe(false);
    expect(parseRdxThemeV1('rdx-theme-v1:null').ok).toBe(false);
    expect(parseRdxThemeV1('rdx-theme-v1:{"variant":"neon"}').ok).toBe(false);
    expect(parseRdxThemeV1('rdx-theme-v1:{"variant":"light"}', 'dark').ok).toBe(false);
    expect(parseRdxThemeV1('rdx-theme-v1:{"variant":"dark"}').ok).toBe(false);
  });
});
