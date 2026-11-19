import { expect, it } from 'vitest';
import type { KnowledgeTopicProposal } from '@shared/types/knowledge';
import { buildTopicChanges } from './knowledgeTopicChanges';

it('prepares only selected cards, edited synonyms and explicit merges for preview', () => {
  const proposal: KnowledgeTopicProposal = {
    revision: 'a'.repeat(64), corpusRevision: 'b'.repeat(64),
    current: { schemaVersion: 1, topics: [{ id: 'old', label: 'Old', synonyms: [] }, { id: 'new', label: 'New', synonyms: [] }], assignments: [] },
    suggestions: [{ topic: { id: 'texture', label: 'Texture', synonyms: ['纹理'] }, existing: false, cards: [
      { cardId: 'first', title: 'First', relativePath: 'a.md', contentHash: 'c'.repeat(64), matchedTerms: ['纹理'] },
      { cardId: 'second', title: 'Second', relativePath: 'b.md', contentHash: 'd'.repeat(64), matchedTerms: ['纹理'] },
    ] }],
  };
  const changes = buildTopicChanges({ proposal, suggestions: proposal.suggestions, selected: { texture: ['first'] },
    synonyms: { texture: '纹理, 贴图' }, customIds: [], mergeTargets: { old: 'new' } });
  expect(changes.topics).toEqual([{ id: 'texture', label: 'Texture', synonyms: ['纹理', '贴图'] }]);
  expect(changes.assignments).toEqual([{ cardId: 'first', contentHash: 'c'.repeat(64), topicIds: ['texture'] }]);
  expect(changes.merges).toEqual([{ sourceId: 'old', targetId: 'new' }]);
});
