import { describe, expect, it } from 'vitest';
import { normalizeAssistantMarkdown } from './normalizeAssistantMarkdown';

describe('normalizeAssistantMarkdown', () => {
  it('compacts loose unordered list spacing', () => {
    const input = ['\u2022 first', '', '\u2022 second', '', '\u25aa third'].join('\n');

    expect(normalizeAssistantMarkdown(input)).toBe(['- first', '- second', '- third'].join('\n'));
  });

  it('compacts nested list spacing without flattening indentation', () => {
    const input = ['- parent', '', '  \u25e6 child one', '', '  \u25e6 child two', '', '- sibling'].join('\n');

    expect(normalizeAssistantMarkdown(input)).toBe([
      '- parent',
      '  - child one',
      '  - child two',
      '- sibling',
    ].join('\n'));
  });

  it('preserves fenced code block content exactly', () => {
    const fence = '\u0060\u0060\u0060';
    const input = [fence + 'txt', 'line one', '', '\u2022 not a bullet', '', 'line two', fence].join('\n');

    expect(normalizeAssistantMarkdown(input)).toBe(input);
  });

  it('collapses repeated paragraph blanks outside lists', () => {
    const input = ['First paragraph.', '', '', 'Second paragraph.'].join('\n');

    expect(normalizeAssistantMarkdown(input)).toBe(['First paragraph.', '', 'Second paragraph.'].join('\n'));
  });

  it('promotes summary headings', () => {
    expect(normalizeAssistantMarkdown('\u603b\u7ed3\uff1a')).toBe('### \u603b\u7ed3');
    expect(normalizeAssistantMarkdown('Conclusion:')).toBe('### Conclusion');
  });
});
