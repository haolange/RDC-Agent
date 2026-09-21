import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ResourceListDetail } from './ResourceListDetail';

describe('resource frame layouts', () => {
  it.each(['compact', 'fill'] as const)('renders a single %s empty state and action group', (emptyLayout) => {
    const html = renderToStaticMarkup(React.createElement(ResourceListDetail, {
      toolbar: 'Scope', isEmpty: true, emptyTitle: 'No resources', emptyLayout,
      emptyActions: React.createElement('button', null, 'Add resource'), list: 'hidden list', detail: 'hidden editor',
    }));
    expect(html).toContain(`is-layout-${emptyLayout}`);
    expect(html.match(/Add resource/g)).toHaveLength(1);
    expect(html).not.toContain('hidden list');
    expect(html).not.toContain('hidden editor');
  });

  it('keeps the toolbar and editor while removing empty actions in populated state', () => {
    const html = renderToStaticMarkup(React.createElement(ResourceListDetail, {
      toolbar: 'Scope', isEmpty: false, emptyTitle: 'No resources', emptyActions: 'Add resource', detail: 'Document editor',
    }));
    expect(html).toContain('is-detail-only');
    expect(html).toContain('Document editor');
    expect(html).not.toContain('Add resource');
  });

  it('renders populated Hook list and detail instead of the fill empty state', () => {
    const html = renderToStaticMarkup(React.createElement(ResourceListDetail, {
      toolbar: 'Scope', isEmpty: false, emptyTitle: 'No Hooks', emptyLayout: 'fill',
      list: 'Hook resources', detail: 'Hook trust and test results',
    }));
    expect(html).toContain('settings-resource-list-column');
    expect(html).toContain('settings-resource-detail-column');
    expect(html).toContain('Hook trust and test results');
    expect(html).not.toContain('ui-empty-state');
  });
});
