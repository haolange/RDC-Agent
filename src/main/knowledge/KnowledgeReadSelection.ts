import type { KnowledgeCardDetail } from '@shared/types/knowledge';

export function selectKnowledgeContent(card: KnowledgeCardDetail, args: Record<string, unknown>): { content: string; range: string } {
  const mode = typeof args.mode === 'string' ? args.mode : 'full';
  const expected = typeof args.contentHash === 'string' ? args.contentHash.trim().replace(/^sha256:/, '') : '';
  if (mode !== 'summary' && !expected) throw new Error('KNOWLEDGE_VERSION_REQUIRED: select a versioned summary or search result first.');
  if (expected && expected !== card.contentHash) throw new Error('KNOWLEDGE_VERSION_CHANGED: the card has changed; search again before reading.');
  if (mode === 'summary') return { content: card.preview ?? '', range: 'summary' };
  if (mode === 'full') return { content: card.content, range: 'full' };
  const lines = card.content.split(/\r?\n/u);
  if (mode === 'range') {
    const start = args.startLine, end = args.endLine;
    if (!Number.isInteger(start) || !Number.isInteger(end) || (start as number) < 1 || (end as number) < (start as number) || (end as number) > lines.length) {
      throw new Error('KNOWLEDGE_RANGE_INVALID: provide an existing 1-based inclusive line range.');
    }
    return { content: lines.slice((start as number) - 1, end as number).join('\n'), range: `lines ${start}-${end}` };
  }
  if (mode === 'section') {
    const heading = typeof args.heading === 'string' ? args.heading.trim() : '';
    const requestedLine = args.headingLine;
    if (requestedLine !== undefined && (!Number.isInteger(requestedLine) || (requestedLine as number) < 1)) {
      throw new Error('KNOWLEDGE_SECTION_NOT_FOUND: provide a valid heading line.');
    }
    const matchesHeading = (line: string) => /^#{1,6}\s+/u.test(line) && line.replace(/^#{1,6}\s+/u, '').trim() === heading;
    const index = requestedLine === undefined ? lines.findIndex(matchesHeading) : (requestedLine as number) - 1;
    if (!heading || index < 0 || index >= lines.length || !matchesHeading(lines[index])) throw new Error('KNOWLEDGE_SECTION_NOT_FOUND: provide an exact Markdown heading.');
    const level = /^#+/u.exec(lines[index])![0].length;
    let end = index + 1;
    while (end < lines.length) {
      const next = /^(#{1,6})\s+/u.exec(lines[end]);
      if (next && next[1].length <= level) break;
      end++;
    }
    return { content: lines.slice(index, end).join('\n'), range: `lines ${index + 1}-${end}` };
  }
  throw new Error('KNOWLEDGE_READ_MODE_INVALID: choose summary, section, range, or full.');
}
