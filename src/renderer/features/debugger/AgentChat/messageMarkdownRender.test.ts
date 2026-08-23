import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown, { type Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import { describe, expect, it } from 'vitest';
import { normalizeAssistantMarkdown } from './normalizeAssistantMarkdown';

function renderMarkdown(content: string, extras?: { highlight?: boolean; katex?: boolean }): string {
  const normalized = normalizeAssistantMarkdown(content);
  const rehypePlugins: NonNullable<Options['rehypePlugins']> = [];
  if (extras?.katex) rehypePlugins.push(rehypeKatex);
  if (extras?.highlight) rehypePlugins.push([rehypeHighlight, { detect: true, ignoreMissing: true }]);
  return renderToStaticMarkup(
    createElement(
      Markdown,
      {
        remarkPlugins: [remarkGfm, remarkMath],
        rehypePlugins: rehypePlugins.length > 0 ? rehypePlugins : undefined,
      },
      normalized,
    ),
  );
}

describe('MessageMarkdown pipeline for GPT thinking titles', () => {
  it('renders a standalone **title** as strong, not literal asterisks', () => {
    const html = renderMarkdown('**Planning project purpose inspection**');
    expect(html).toContain('<strong>');
    expect(html).not.toContain('**');
    expect(html).toContain('Planning project purpose inspection');
  });

  it('renders mixed summary title plus body', () => {
    const html = renderMarkdown(
      '**Planning project purpose inspection**\n\nI will inspect the repository next.',
    );
    expect(html).toContain('<strong>Planning project purpose inspection</strong>');
    expect(html).not.toContain('**');
  });

  it('keeps strong emphasis when highlight detection and KaTeX plugins are on', () => {
    const html = renderMarkdown('**Planning project purpose inspection**', {
      highlight: true,
      katex: true,
    });
    expect(html).toContain('<strong>Planning project purpose inspection</strong>');
    expect(html).not.toContain('**');
  });
});
