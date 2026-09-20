import { describe, expect, it } from 'vitest';
import { parseRdcThemeV1, serializeRdcThemeV1 } from './rdcThemeV1';

const chrome = {
  presetId: 'rdc' as const,
  accent: '#33d1ff',
  surface: '#101418',
  ink: '#e8eef5',
  contrast: 45,
  fonts: { ui: null, code: null },
};

describe('rdcThemeV1', () => {
  it('round-trips serialize/parse', () => {
    const encoded = serializeRdcThemeV1(chrome, 'dark');
    expect(encoded.startsWith('rdc-theme-v1:')).toBe(true);
    const parsed = parseRdcThemeV1(encoded, 'dark');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.payload.variant).toBe('dark');
      expect(parsed.chrome.accent).toBe('#33d1ff');
    }
  });

  it('rejects unsupported prefixes and bad payloads', () => {
    expect(parseRdcThemeV1('codex-theme-v1:{}').ok).toBe(false);
    expect(parseRdcThemeV1('nope').ok).toBe(false);
    expect(parseRdcThemeV1('rdc-theme-v1:{').ok).toBe(false);
    expect(parseRdcThemeV1('rdc-theme-v1:null').ok).toBe(false);
    expect(parseRdcThemeV1('rdc-theme-v1:{"variant":"neon"}').ok).toBe(false);
    expect(parseRdcThemeV1('rdc-theme-v1:{"variant":"light"}', 'dark').ok).toBe(false);
    expect(parseRdcThemeV1('rdc-theme-v1:{"variant":"dark"}').ok).toBe(false);
  });
});
