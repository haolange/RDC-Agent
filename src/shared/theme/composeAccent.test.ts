import { describe, expect, it } from 'vitest';
import {
  COMPOSE_ACCENT_FALLBACK,
  deriveComposeAccentVars,
  modulateAccentForTheme,
  normalizeAgentAccent,
} from './composeAccent';

describe('composeAccent', () => {
  it('normalizeAgentAccent falls back for invalid values', () => {
    expect(normalizeAgentAccent(null)).toBe(COMPOSE_ACCENT_FALLBACK);
    expect(normalizeAgentAccent('#AABBCC')).toBe('#aabbcc');
    expect(normalizeAgentAccent('bad', '#112233')).toBe('#112233');
  });

  it('deriveComposeAccentVars emits light and dark effort vars', () => {
    const dark = deriveComposeAccentVars('#33d1ff', 'dark');
    expect(dark['--composer-mode-accent']).toBe('#33d1ff');
    expect(dark['--composer-effort-fill-1']).toMatch(/^hsl\(/);
    expect(dark['--composer-effort-max-from']).toMatch(/^#/);

    const light = deriveComposeAccentVars('not-hex', 'light');
    expect(light['--composer-mode-accent']).toBe(COMPOSE_ACCENT_FALLBACK);
    expect(light['--composer-effort-thumb']).toMatch(/^hsl\(/);
  });

  it('keeps dark effort tiers visually anchored to a light violet agent accent', () => {
    const analyzer = deriveComposeAccentVars('#8d8bff', 'dark');
    expect(analyzer['--composer-mode-accent']).toBe('#8d8bff');
    expect(analyzer['--composer-effort-fill-3']).toBe('hsl(241 97% 77%)');
    expect(analyzer['--composer-effort-fill-4']).toBe('hsl(241 100% 73%)');
    expect(analyzer['--composer-effort-fill-5']).toBe('hsl(241 100% 69%)');
  });

  it('modulateAccentForTheme preserves hue while clamping luminance', () => {
    const light = modulateAccentForTheme('#33d1ff', 'light');
    const dark = modulateAccentForTheme('#33d1ff', 'dark');
    expect(light).toMatch(/^#/);
    expect(dark).toMatch(/^#/);
    expect(light).not.toBe(dark);
  });
});
