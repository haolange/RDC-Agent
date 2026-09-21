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
  ])('keeps the empty explanation without duplicating the toolbar import action', (spaces, searchQuery, reason) => {
    const state = { spaces, searchQuery, viewMode: 'cards', index: { cardCount: 0 }, hits: [],
      loadingQuery: false, loadingOverview: false, setSearchQuery: vi.fn(), pack: null,
    } as unknown as Parameters<typeof ListColumn>[0]['state'];
    const html = renderToStaticMarkup(createElement(ListColumn, { state, inbox: null }));
    expect(html).toContain(reason);
    expect(html).not.toContain('knowledgeCenter.importKnowledge');
    expect(html).not.toContain('ui-empty-state-actions');
    expect(html).toContain('knowledge-center-search');
  });
});
