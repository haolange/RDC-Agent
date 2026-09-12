import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Tabs } from './Tabs';
import { resolveTabNavigation } from './tabsNavigation';

const tabs = [{ id: 'write', label: 'Write' }, { id: 'disabled', label: 'Disabled', disabled: true }, { id: 'preview', label: 'Preview' }];
describe('Tabs accessibility and navigation', () => {
  it('keeps repeated option ids unique between instances and links only an existing panel', () => {
    const markup = renderToStaticMarkup(React.createElement(React.Fragment, null,
      React.createElement(Tabs, { tabs, value: 'write', onChange() {}, children: 'Content' }),
      React.createElement(Tabs, { tabs, value: 'write', onChange() {} }),
    ));
    const ids = [...markup.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    const controls = [...markup.matchAll(/aria-controls="([^"]+)"/g)].map((match) => match[1]);
    expect(controls).toHaveLength(1);
    expect(ids).toContain(controls[0]);
    expect(markup.match(/tabindex="0"/g)).toHaveLength(2);
  });
  it('keeps an enabled tab reachable when the selected option is disabled', () => {
    const markup = renderToStaticMarkup(React.createElement(Tabs, { tabs, value: 'disabled', onChange() {} }));
    expect(markup).toMatch(/tabindex="0"[^>]*>Write/);
    expect(markup).not.toContain('aria-controls');
  });
  it.each([
    [0, 'ArrowRight', 2], [2, 'ArrowRight', 0], [0, 'ArrowLeft', 2],
    [2, 'Home', 0], [0, 'End', 2], [1, 'ArrowLeft', 2],
    [0, 'Tab', null], [0, 'Enter', null], [0, ' ', null],
  ])('moves from %s with %s to %s', (from, key, expected) => {
    expect(resolveTabNavigation(tabs, from, key)).toBe(expected);
  });
  it('does not intercept keys when no option is enabled', () => {
    expect(resolveTabNavigation([{ disabled: true }], 0, 'Home')).toBeNull();
    expect(resolveTabNavigation([], 0, 'ArrowRight')).toBeNull();
  });
});
