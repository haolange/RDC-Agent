import { selectKnowledgeContent } from './KnowledgeReadSelection';
import type { KnowledgeCardDetail, KnowledgeReadRequest, KnowledgeReadResult } from '@shared/types/knowledge';

/** Project only the selected source range; the metadata cannot contain a second copy of the body. */
export function projectKnowledgeRead(card: KnowledgeCardDetail, request: KnowledgeReadRequest): KnowledgeReadResult {
  const selected = selectKnowledgeContent(card, { ...request });
  const lines = card.content.split(/\r?\n/u);
  const headings = lines.flatMap((line, index) => {
    const match = /^(#{1,6})\s+(.+)$/u.exec(line);
    return match ? [{ title: match[2].trim(), level: match[1].length, line: index + 1 }] : [];
  });
  const { content: _content, body: _body, chapters: _chapters, ...metadata } = card;
  return { card: metadata, content: selected.content, range: selected.range, headings, lineCount: lines.length };
}
