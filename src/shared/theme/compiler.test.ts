import { describe, expect, it } from 'vitest';
import { BOUNDARY_CONTRAST, TEXT_CONTRAST, compileThemeChrome, compiledChromeToInlineStyle } from './compiler';
import { contrastRatio, relativeLuminance } from './color';
import { THEME_PRESET_CATALOG } from './presets';

const tripletRgb = (triplet: string) => {
  const [r, g, b] = triplet.split(' ').map(Number);
  return { r, g, b };
};

describe('preset contrast', () => {
  const cases = THEME_PRESET_CATALOG.flatMap((preset) => (['dark', 'light'] as const)
    .map((variant) => ({ id: preset.id, variant, chrome: preset[variant] })));

  it.each(cases)('$id $variant reads at AA on every chrome surface', ({ variant, chrome }) => {
    const vars = compileThemeChrome(chrome, variant);
    const surfaces = ['--color-bg-0', '--color-bg-1', '--color-bg-2', '--color-bg-3', '--color-surface-overlay']
      .map((token) => tripletRgb(vars[token]));
    const worst = (token: string) => Math.min(...surfaces.map((surface) => contrastRatio(tripletRgb(vars[token]), surface)));
    const text = ['primary', 'secondary', 'tertiary', 'muted'].map((step) => `--color-text-${step}`);
    const status = ['success', 'warning', 'error', 'info'].map((name) => `--color-${name}`);
    for (const token of [...text, ...status, '--color-accent-ink']) expect(worst(token), token).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    expect(worst('--color-focus-ring')).toBeGreaterThanOrEqual(BOUNDARY_CONTRAST);
    expect(contrastRatio(tripletRgb(vars['--color-text-on-accent']), tripletRgb(vars['--color-accent-ink']))).toBeGreaterThanOrEqual(TEXT_CONTRAST);
  });

  it('moves only the default RDC values that missed AA', () => {
    const rdc = THEME_PRESET_CATALOG[0];
    const dark = compileThemeChrome(rdc.dark, 'dark');
    expect(dark['--color-focus-ring']).toBe(dark['--color-accent-500']);
    expect([dark['--color-text-secondary'], dark['--color-info'], dark['--color-error']]).toEqual(['200 202 203', '56 189 248', '255 138 128']);
    const light = compileThemeChrome(rdc.light, 'light');
    // Declared fixes: the accent focus ring read 2.5:1 and the sky-blue info 1.7:1 on the light chrome.
    expect([light['--color-accent-500'], light['--color-focus-ring']]).toEqual(['27 157 204', '24 140 181']);
    expect(light['--color-info']).toBe('5 110 156');
    expect([light['--color-text-secondary'], light['--color-success']]).toEqual(['63 70 78', '20 108 61']);
  });
});

const chrome = {
  presetId: 'rdc' as const,
  accent: '#33d1ff',
  surface: '#101418',
  ink: '#e8eef5',
  contrast: 45,
  fonts: { ui: 'Custom UI', code: 'Custom Code' },
};

describe('theme compiler', () => {
  it.each([
    { variant: 'dark' as const, surface: '#282826', ink: '#e8e8e6' },
    { variant: 'light' as const, surface: '#f5f5f5', ink: '#2a2a2a' },
  ])('keeps captions and placeholders readable on $variant controls', ({ variant, surface, ink }) => {
    const vars = compileThemeChrome({ ...chrome, surface, ink }, variant);
    const luminance = (triplet: string) => {
      const [r, g, b] = triplet.split(' ').map(Number);
      return relativeLuminance({ r, g, b });
    };
    const bg = luminance(vars['--color-bg-3']);
    for (const token of ['--color-text-tertiary', '--color-text-muted', '--color-success', '--color-warning', '--color-error']) {
      const fg = luminance(vars[token]);
      expect((Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it.each([
    { variant: 'dark' as const, accent: '#1f3a8a', surface: '#101418', ink: '#e8eef5' },
    { variant: 'dark' as const, accent: '#33d1ff', surface: '#101418', ink: '#e8eef5' },
    { variant: 'light' as const, accent: '#33d1ff', surface: '#fafbfd', ink: '#151d27' },
    { variant: 'light' as const, accent: '#ffd400', surface: '#f5f5f5', ink: '#2a2a2a' },
  ])('keeps $accent accent text and filled-accent labels readable on $variant chrome', ({ variant, accent, surface, ink }) => {
    const vars = compileThemeChrome({ ...chrome, accent, surface, ink }, variant);
    const rgb = (triplet: string) => {
      const [r, g, b] = triplet.split(' ').map(Number);
      return { r, g, b };
    };
    const accentInk = rgb(vars['--color-accent-ink']);
    for (const step of ['1', '2', '3']) {
      expect(contrastRatio(accentInk, rgb(vars[`--color-bg-${step}`]))).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio(rgb(vars['--color-text-on-accent']), accentInk)).toBeGreaterThanOrEqual(4.5);
  });
  it('compiles dark and light chrome CSS vars', () => {
    const dark = compileThemeChrome(chrome, 'dark');
    expect(dark['--color-accent-500']).toMatch(/\d+ \d+ \d+/);
    expect(dark['--font-sans']).toBe('Custom UI');
    expect(dark['--color-border-subtle']).toContain('255 255 255');
    expect(compiledChromeToInlineStyle(dark)).toContain('--color-accent-500:');

    const light = compileThemeChrome({
      ...chrome,
      fonts: { ui: null, code: null },
      surface: '#fafbfd',
      ink: '#151d27',
    }, 'light');
    expect(light['--surface-elevated']).toBe('rgb(var(--color-bg-2))');
    expect(light['--token-surface-raised']).toBe('rgb(var(--color-bg-1))');
    expect(light['--font-sans']).toBeUndefined();
    expect(light['--font-mono']).toBeUndefined();
  });
});
