import { describe, expect, it } from 'vitest';
import { compileThemeChrome, compiledChromeToInlineStyle } from './compiler';

const chrome = {
  presetId: 'rdc' as const,
  accent: '#33d1ff',
  surface: '#101418',
  ink: '#e8eef5',
  contrast: 45,
  fonts: { ui: 'Custom UI', code: 'Custom Code' },
};

describe('theme compiler', () => {
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
    expect(light['--surface-elevated']).toContain('255 255 255');
    expect(light['--token-surface-raised']).toContain('linear-gradient');
    expect(light['--font-sans']).toMatch(/Inter/);
  });
});
