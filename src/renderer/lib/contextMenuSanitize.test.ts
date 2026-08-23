import { describe, expect, it } from 'vitest';
import { sanitizePastedText } from './contextMenuSanitize';

describe('sanitizePastedText', () => {
  it('strips zero-width marks, converts NBSP, and normalizes newlines', () => {
    expect(sanitizePastedText('a\u200B\u200C\uFEFFb\u00A0c\r\nd')).toBe('ab c\nd');
  });

  it('converts smart quotes and full-width punctuation to ASCII', () => {
    expect(sanitizePastedText('“hello” ‘world’ — 你好，世界。')).toBe('"hello" \'world\' - 你好,世界.');
  });
});
