import { expect, it } from 'vitest';
import type { KnowledgeCardDetail } from '@shared/types/knowledge';
import { projectKnowledgeRead } from './KnowledgeReadService';

it('projects a same-version preview, section, line range and raw source without leaking the remaining body', () => {
  const source = '---\ntitle: Sample\n---\n# Sample\n\n## Evidence\nsource\n\n## Other\nother\n';
  const card: KnowledgeCardDetail = { cardId: 'user:a', spaceId: 'user', relativePath: 'a.md', title: 'Sample',
    contentHash: 'a'.repeat(64), preview: 'Brief', content: source, body: '# Sample\n\n## Evidence\nsource',
    chapters: { evidence: 'source' }, scope: {}, relations: [] };
  const base = { spaceId: 'user', relativePath: 'a.md' };
  const summary = projectKnowledgeRead(card, { ...base, mode: 'summary' });
  expect(summary.content).toBe('Brief');
  expect(summary.card).not.toHaveProperty('body');
  expect(summary.card).not.toHaveProperty('chapters');
  expect(summary.headings).toContainEqual({ title: 'Evidence', line: 6, level: 2 });
  expect(() => projectKnowledgeRead(card, { ...base, mode: 'full' })).toThrow('VERSION_REQUIRED');
  expect(() => projectKnowledgeRead(card, { ...base, mode: 'full', contentHash: 'b'.repeat(64) })).toThrow('VERSION_CHANGED');
  const version = { ...base, contentHash: card.contentHash };
  expect(projectKnowledgeRead(card, { ...version, mode: 'section', heading: 'Evidence' })).toMatchObject({ range: 'lines 6-8', content: '## Evidence\nsource\n' });
  expect(() => projectKnowledgeRead(card, { ...version, mode: 'section', heading: 'Evidence', headingLine: 9 })).toThrow('SECTION_NOT_FOUND');
  expect(projectKnowledgeRead(card, { ...version, mode: 'range', startLine: 2, endLine: 3 }).content).toBe('title: Sample\n---');
  expect(projectKnowledgeRead(card, { ...version, mode: 'full' }).content).toBe(source);
});
