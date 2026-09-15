import { describe, expect, it } from 'vitest';
import { createDefaultUiPreferences, mergeUiPreferences, sanitizeUiPreferences } from './uiPreferences';

describe('UI preferences without motion controls', () => {
  it.each(['on', 'off', 'system'])('drops an old %s motion preference while retaining appearance', (reduceMotion) => {
    const saved = {
      ...createDefaultUiPreferences(),
      theme: 'light',
      fontScale: 'large',
      composerMarkdown: true,
      reduceMotion,
    };
    const sanitized = sanitizeUiPreferences(saved);
    expect(sanitized).not.toHaveProperty('reduceMotion');
    expect(sanitized).toMatchObject({ theme: 'light', fontScale: 'large', composerMarkdown: true });
    expect(sanitized.chromeThemes).toEqual(saved.chromeThemes);
    expect(mergeUiPreferences(sanitized, { fontScale: 'small' })).not.toHaveProperty('reduceMotion');
  });

  it('does not recreate a discarded preference on save', () => {
    const defaults = createDefaultUiPreferences();
    expect(defaults).not.toHaveProperty('reduceMotion');
    const patch = { theme: 'light' as const, reduceMotion: 'on' };
    const result = mergeUiPreferences(defaults, patch);
    expect(result.theme).toBe('light');
    expect(result).not.toHaveProperty('reduceMotion');
    expect(JSON.parse(JSON.stringify(result))).toEqual(sanitizeUiPreferences(result));
  });
});
