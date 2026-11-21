import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ListColumn } from './ListColumn';

vi.mock('../../../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../parts/KnowledgeFilters', () => ({ KnowledgeFilters: () => null }));

describe('Knowledge list empty actions', () => {
  it.each([
    [[], '', 'knowledgeCenter.emptyNoSpaces'],
    [[{}], '', 'knowledgeCenter.emptyNoCards'],
    [[{}], 'missing', 'knowledgeCenter.emptyNoHits'],
  ])('explains an empty list and offers import only where the cards would be', (spaces, searchQuery, reason) => {
    const state = { spaces, searchQuery, viewMode: 'cards', index: { cardCount: 0 }, hits: [],
      loadingQuery: false, loadingOverview: false, setSearchQuery: vi.fn(), pack: null, page: {},
    } as unknown as Parameters<typeof ListColumn>[0]['state'];
    const html = renderToStaticMarkup(createElement(ListColumn, { state, inbox: null, onImport: vi.fn() }));
    expect(html).toContain(reason);
    expect(html.includes('knowledge-center-empty-import')).toBe(reason === 'knowledgeCenter.emptyNoCards');
    expect(html).toContain('knowledge-center-search');
  });
});
