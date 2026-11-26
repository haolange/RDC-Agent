import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { normalizeWebUrl } from '@shared/utils/webUrl';
import { MessageMarkdown } from './MessageMarkdown';
import { MarkdownSourceProvider, citedSources } from './markdownSources';
import { isFenceClosed } from './rehypeOpenFence';
import { markdownMediaRoute } from './useMarkdownMedia';

vi.mock('./markdownHighlight', () => ({ MARKDOWN_LANGUAGES: {}, MARKDOWN_LANGUAGE_ALIASES: {} }));
vi.mock('katex/dist/katex.min.css', () => ({}));

const read = {
  url: 'https://renderdoc.org/docs/',
  domain: 'renderdoc.org',
  title: 'RenderDoc Docs',
  summary: 'Getting started.',
};

const render = (content: string, deferHeavyPlugins = false) =>
  renderToStaticMarkup(
    createElement(MarkdownSourceProvider, {
      sources: [read],
      children: createElement(MessageMarkdown, { content, deferHeavyPlugins }),
    }),
  );

describe('rich answer Markdown', () => {
  it('cites a page the turn read as a pill and leaves other links as plain external links', () => {
    const html = render('见 [文档](https://www.renderdoc.org/docs) 与 [别处](https://example.com/a)。');
    expect(html).toMatch(
      /<a class="markdown-citation" href="https:\/\/renderdoc.org\/docs\/"[^>]*data-tooltip="RenderDoc Docs\nGetting started."/,
    );
    expect(html).toContain('<span class="ui-overflow-fade markdown-citation-label">renderdoc.org</span>');
    expect(html).toMatch(
      /<a href="https:\/\/example.com\/a" target="_blank" rel="noreferrer noopener" data-tooltip="example.com">别处<\/a>/,
    );
  });

  it('keeps footnote references in the page', () => {
    const html = render('正文[^1]\n\n[^1]: 注释');
    const reference = /<a[^>]*data-footnote-ref[^>]*>/.exec(html)?.[0] ?? '';
    expect(reference).toContain('href="#user-content-fn-1"');
    expect(reference).not.toContain('target=');
    expect(html).toContain('class="sr-only"');
  });

  it('renders > [!WARNING] as a callout without the marker', () => {
    const html = render('> [!WARNING]\n> 先备份 capture。');
    expect(html).toContain('class="markdown-callout is-warning"');
    expect(html).toContain('先备份 capture。');
    expect(html).not.toContain('[!WARNING]');
  });

  it('names the file a fence declares and folds blocks past thirty lines', () => {
    const titled = render('```ts:src/app.ts\nconst a = 1;\n```');
    expect(titled).toContain('<span class="ui-overflow-fade markdown-code-block-file">src/app.ts</span>');
    expect(titled).toContain('<span class="markdown-code-block-lang">ts</span>');
    const long = render(`\`\`\`text\n${Array.from({ length: 40 }, (_, line) => `line ${line}`).join('\n')}\n\`\`\``);
    expect(long).toContain('markdown-code-block is-folded');
    expect(long).toContain('aria-expanded="false"');
  });

  it('keeps the language of a block whose fence is still streaming', () => {
    const html = render('```hlsl\nfloat4 main() : SV_Target', true);
    expect(html).toContain('<span class="markdown-code-block-lang">hlsl</span>');
  });
});

describe('answer helpers', () => {
  it('tells closed fences from open ones', () => {
    expect(isFenceClosed('```ts\nconst a = 1;\n```')).toBe(true);
    expect(isFenceClosed('```ts\nconst a')).toBe(false);
    expect(isFenceClosed('~~~\na\n```')).toBe(false);
    expect(isFenceClosed('    indented code')).toBe(true);
  });

  it('lists cited reads once, in citation order', () => {
    const sources = new Map([[normalizeWebUrl(read.url), read]]);
    expect(
      citedSources('[a](https://renderdoc.org/docs) [b](https://renderdoc.org/docs/#x) [c](https://x.dev)', sources),
    ).toEqual([read]);
  });

  it('routes media references to one controlled channel or none', () => {
    expect(markdownMediaRoute('https://cdn.example.com/a.png')).toBe('remote');
    expect(markdownMediaRoute('http://cdn.example.com/a.png')).toBeNull();
    expect(markdownMediaRoute('javascript:alert(1)')).toBeNull();
    expect(markdownMediaRoute('session://tool-outputs/shot.png')).toBe('local');
    expect(markdownMediaRoute('docs/frame.png')).toBe('local');
  });
});
