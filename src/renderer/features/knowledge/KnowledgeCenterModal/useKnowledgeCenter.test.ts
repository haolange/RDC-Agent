import { describe, expect, it } from 'vitest';
import type { KnowledgeLaneHit, KnowledgePack } from '@shared/types/knowledge';
import { assignKnowledgeCenterList, includeSelectedSpaceId } from './knowledgeCenterQuery';

function hit(cardId: string, score: number): KnowledgeLaneHit {
  return {
    cardId,
    spaceId: 'user',
    relativePath: `${cardId}.md`,
    title: cardId,
    score,
    lanes: ['Lexical'],
  };
}

describe('assignKnowledgeCenterList', () => {
  const queryHits = [hit('query-first', 1), hit('query-second', 9)];
  const compiled: KnowledgePack = {
    packId: 'pack-order',
    compiledAt: '2026-09-01T00:00:00.000Z',
    hits: [
      { ...hit('query-second', 9), reasons: ['Lexical:9'] },
      { ...hit('query-first', 1), reasons: ['Lexical:1'] },
    ],
    conflicts: [],
  };

  it('keeps knowledge.query hit order for Cards and still stores the pack', () => {
    expect(assignKnowledgeCenterList('cards', queryHits, compiled)).toEqual({
      hits: queryHits,
      pack: compiled,
    });
  });

  it('keeps knowledge.query hit order for Candidates', () => {
    expect(assignKnowledgeCenterList('candidates', queryHits, compiled).hits).toEqual(queryHits);
  });

  it('uses compiled hits only in Conflicts', () => {
    expect(assignKnowledgeCenterList('conflicts', queryHits, compiled).hits).toEqual(compiled.hits);
  });

  it('adds the imported space to the current selection', () => {
    expect(includeSelectedSpaceId(['project:a'], 'user')).toEqual(['project:a', 'user']);
    expect(includeSelectedSpaceId(['user'], 'user')).toEqual(['user']);
  });
});
