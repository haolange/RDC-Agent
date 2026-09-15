import { describe, expect, it } from 'vitest';
import {
  groupKnowledgeImages,
  isSafeKnowledgePreviewPath,
  normalizeKnowledgePreviewPath,
} from './knowledgeCardImages';

describe('knowledge card image grouping', () => {
  it('pairs observed and reference in order', () => {
    const grouped = groupKnowledgeImages([
      { relativePath: 'cases/a/observed.png', role: 'observed' },
      { relativePath: 'cases/a/extra.png', role: 'illustration' },
      { relativePath: 'cases/a/reference.png', role: 'reference' },
    ]);
    expect(grouped.pairs).toEqual([{
      observed: { relativePath: 'cases/a/observed.png', role: 'observed' },
      reference: { relativePath: 'cases/a/reference.png', role: 'reference' },
    }]);
    expect(grouped.singles).toEqual([{ relativePath: 'cases/a/extra.png', role: 'illustration' }]);
  });

  it('rejects traversal and non-image preview paths', () => {
    expect(isSafeKnowledgePreviewPath('../escape.png')).toBe(false);
    expect(isSafeKnowledgePreviewPath('cases/a/notes.txt')).toBe(false);
    expect(normalizeKnowledgePreviewPath('./cases/a/observed.png')).toBe('cases/a/observed.png');
    expect(isSafeKnowledgePreviewPath('cases/a/observed.png')).toBe(true);
  });
});
