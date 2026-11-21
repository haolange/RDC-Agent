import { describe, expect, it } from 'vitest';
import { compileThemeChrome, compiledChromeToInlineStyle } from './compiler';
import { contrastRatio, relativeLuminance } from './color';

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
