import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SearchMultiSelect, type SearchMultiSelectProps } from './SearchMultiSelect';
import { filterMultiSelectOptions, toggleMultiSelectId } from './searchMultiSelectModel';

const props: SearchMultiSelectProps = { value: ['missing'], options: [{ id: 'a', label: 'Alpha', source: 'builtin' }],
  onChange() {}, label: 'Skills', searchLabel: 'Search skills', emptyLabel: 'No skills', noResultsLabel: 'No matches',
  loadingLabel: 'Loading', unavailableLabel: 'Unavailable', removeLabel: (id) => `Remove ${id}` };

describe('SearchMultiSelect', () => {
  it('searches name/id/source, deduplicates options, and preserves selection order', () => {
    expect(filterMultiSelectOptions([...props.options, ...props.options], 'BUILTIN')).toHaveLength(1);
    expect(filterMultiSelectOptions(props.options, 'nothing')).toEqual([]);
    expect(toggleMultiSelectId(['b', 'a', 'b'], 'c', true)).toEqual(['b', 'a', 'c']);
    expect(toggleMultiSelectId(['b', 'a'], 'a', true)).toEqual(['b', 'a']);
    expect(toggleMultiSelectId(['b', 'a'], 'b', false)).toEqual(['a']);
  });
  it('retains invalid selected IDs with explicit removal and native checkbox controls', () => {
    const markup = renderToStaticMarkup(React.createElement(SearchMultiSelect, props));
    expect(markup).toContain('missing');
    expect(markup).toContain('Unavailable');
    expect(markup).toContain('aria-label="Remove missing"');
    expect(markup).toContain('type="checkbox"');
  });
  it('distinguishes failure and loading from an empty catalog without declaring missing references', () => {
    const loading = renderToStaticMarkup(React.createElement(SearchMultiSelect, { ...props, options: [], loading: true }));
    expect(loading).toContain('aria-busy="true"');
    expect(loading).not.toContain('Unavailable');
    expect(loading).not.toContain('No skills');
    const failed = renderToStaticMarkup(React.createElement(SearchMultiSelect, { ...props, options: [], error: 'Read failed' }));
    expect(failed).toContain('role="alert"');
    expect(failed).not.toContain('Unavailable');
    expect(failed).not.toContain('No skills');
  });
});
