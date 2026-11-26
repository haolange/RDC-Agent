import { describe, expect, it } from 'vitest';
import { parseRdcTheme, serializeRdcTheme } from './rdcTheme';

const chrome = {
  presetId: 'rdc' as const,
  accent: '#33d1ff',
  surface: '#101418',
  ink: '#e8eef5',
  contrast: 45,
  fonts: { ui: null, code: null },
};

describe('rdcTheme', () => {
  it('round-trips serialize/parse', () => {
    const encoded = serializeRdcTheme(chrome, 'dark');
    expect(encoded.startsWith('rdc-theme:')).toBe(true);
    const parsed = parseRdcTheme(encoded, 'dark');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.payload.variant).toBe('dark');
      expect(parsed.chrome.accent).toBe('#33d1ff');
    }
  });

  it('rejects unsupported prefixes and bad payloads', () => {
    expect(parseRdcTheme('codex-theme-v1:{}').ok).toBe(false);
    expect(parseRdcTheme('nope').ok).toBe(false);
    expect(parseRdcTheme('rdc-theme:{').ok).toBe(false);
    expect(parseRdcTheme('rdc-theme:null').ok).toBe(false);
    expect(parseRdcTheme('rdc-theme:{"variant":"neon"}').ok).toBe(false);
    expect(parseRdcTheme('rdc-theme:{"variant":"light"}', 'dark').ok).toBe(false);
    expect(parseRdcTheme('rdc-theme:{"variant":"dark"}').ok).toBe(false);
  });
});
