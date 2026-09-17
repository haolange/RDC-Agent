import { describe, expect, it } from 'vitest';
import type { KnowledgeImportResult, KnowledgeLaneHit } from '@shared/types/knowledge';
import {
  beginSynchronousFlight,
  firstImportedSpaceCard,
  knowledgeExportScopeCounts,
} from './knowledgeImportExportModel';

function hit(cardId: string): KnowledgeLaneHit {
  return {
    cardId,
    spaceId: 'user',
    relativePath: `${cardId}.md`,
    title: cardId,
    score: 1,
    lanes: ['Lexical'],
  };
}

describe('knowledge import/export model', () => {
  it('lets only the first in-flight caller enter', () => {
    const flag = { current: false };
    expect(beginSynchronousFlight(flag)).toBe(true);
    expect(beginSynchronousFlight(flag)).toBe(false);
    expect(beginSynchronousFlight(flag)).toBe(false);
    flag.current = false;
    expect(beginSynchronousFlight(flag)).toBe(true);
  });

  it('selects the first space draft written by import', () => {
    const result: KnowledgeImportResult = {
      candidateCreated: false,
      verified: false,
      items: [
        { status: 'quarantine', lifecycle: null, missingAssets: [], reason: 'secret-detected' },
        {
          status: 'draft',
          lifecycle: 'draft',
          missingAssets: [],
          record: {
            cardId: 'user:cases/one.md',
            spaceId: 'user',
            relativePath: 'cases/one.md',
            type: 'case',
            lifecycle: 'draft',
            title: 'One',
            scope: {},
            relations: [],
            body: 'Body',
          },
        },
      ],
    };
    expect(firstImportedSpaceCard(result)).toEqual({
      spaceId: 'user',
      relativePath: 'cases/one.md',
      cardId: 'user:cases/one.md',
    });
  });

  it('counts export space from the space listing, not the filtered hits', () => {
    expect(knowledgeExportScopeCounts({
      selected: { spaceId: 'user', relativePath: 'cases/one.md' },
      hits: [hit('one')],
      spaceCount: 7,
    })).toEqual({
      selected: 1,
      filtered: 1,
      space: 7,
    });
  });
});
