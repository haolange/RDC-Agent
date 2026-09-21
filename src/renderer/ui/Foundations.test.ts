import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Textarea } from './Textarea';
import { EmptyState } from './EmptyState';
import { Button } from './Button';

describe('shared foundation semantics', () => {
  it('defaults to a single row and leaves native editing attributes intact', () => {
    const html = renderToStaticMarkup(React.createElement(Textarea, { defaultValue: '中文', 'aria-label': 'Prompt', readOnly: true }));
    expect(html).toContain('rows="1"');
    expect(html).toContain('is-sizing-content');
    expect(html).toContain('中文');
    expect(html).toContain('readonly');
    expect(html).not.toContain('style=');
  });
  it('exposes fill mode without adding inline sizing', () => {
    const html = renderToStaticMarkup(React.createElement(Textarea, { sizing: 'fill' }));
    expect(html).toContain('is-sizing-fill');
    expect(html).not.toContain('style=');
  });
  it('preserves empty-state visuals and marks loading buttons disabled and busy', () => {
    const html = renderToStaticMarkup(React.createElement(EmptyState, { title: 'Empty', layout: 'fill', visual: 'Scene' }));
    expect(html).toContain('is-layout-fill');
    expect(html).toContain('ui-empty-state-visual');
    const button = renderToStaticMarkup(React.createElement(Button, { loading: true, children: 'Save' }));
    expect(button).toContain('disabled');
    expect(button).toContain('aria-busy="true"');
  });
});
