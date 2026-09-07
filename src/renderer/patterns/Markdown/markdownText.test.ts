import { describe, expect, it } from 'vitest';
import { flattenMarkdownText } from './markdownText';
import { createElement } from 'react';

describe('flattenMarkdownText', () => {
  it('joins nested text nodes', () => {
    const tree = createElement(
      'code',
      { className: 'language-ts' },
      'const ',
      createElement('span', { className: 'hljs-keyword' }, 'x'),
      ' = 1',
    );

    expect(flattenMarkdownText(tree)).toBe('const x = 1');
  });

  it('returns empty for nullish nodes', () => {
    expect(flattenMarkdownText(null)).toBe('');
    expect(flattenMarkdownText(undefined)).toBe('');
  });
});
