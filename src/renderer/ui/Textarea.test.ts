import { createElement, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Textarea } from './Textarea';

describe('Textarea chrome', () => {
  it('keeps field fill on form textareas', () => {
    const html = renderToStaticMarkup(createElement(Textarea, { 'aria-label': 'Notes' }));
    expect(html).toContain('ui-textarea');
    expect(html).toContain('is-sizing-content');
  });

  it('selects plain chrome without changing the shared textarea identity', () => {
    const html = renderToStaticMarkup(createElement(Textarea, {
      chrome: 'plain',
      className: 'composer-textarea',
      ref: createRef<HTMLTextAreaElement>(),
      'aria-label': 'Prompt',
    }));
    expect(html).toContain('ui-textarea');
    expect(html).toContain('class="ui-textarea is-chrome-plain is-sizing-content composer-textarea"');
  });
});
