import { describe, expect, it } from 'vitest';
import { isKnowledgeImagePathAllowed, sanitizeKnowledgeImages } from './knowledgeImages';

describe('knowledge image paths', () => {
  it('allows images next to the card or under cases/<caseId>/', () => {
    expect(isKnowledgeImagePathAllowed('cases/AIRD-1.md', 'cases/AIRD-1/observed.png', 'AIRD-1')).toBe(true);
    expect(isKnowledgeImagePathAllowed('notes/sample.md', 'notes/shot.png')).toBe(true);
  });

  it('rejects traversal, absolute paths, and off-card destinations', () => {
    expect(isKnowledgeImagePathAllowed('cases/AIRD-1.md', '../escape.png', 'AIRD-1')).toBe(false);
    expect(isKnowledgeImagePathAllowed('cases/AIRD-1.md', '/tmp/shot.png', 'AIRD-1')).toBe(false);
    expect(isKnowledgeImagePathAllowed('cases/AIRD-1.md', 'cases/OTHER/observed.png', 'AIRD-1')).toBe(false);
    expect(isKnowledgeImagePathAllowed('cases/AIRD-1.md', 'cases/AIRD-1/notes.txt', 'AIRD-1')).toBe(false);
  });

  it('drops unsafe image refs from frontmatter', () => {
    const images = sanitizeKnowledgeImages([
      { relativePath: 'cases/AIRD-1/observed.png', role: 'observed' },
      { relativePath: '../escape.png', role: 'reference' },
    ], 'cases/AIRD-1.md', 'AIRD-1');
    expect(images).toEqual([{ relativePath: 'cases/AIRD-1/observed.png', role: 'observed' }]);
  });
});
