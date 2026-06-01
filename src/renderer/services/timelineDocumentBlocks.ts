export type DocumentBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'code'; language?: string; text: string };

export const parseDocumentBlocks = (content: string): DocumentBlock[] => {
  const lines = content.split(/\r?\n/);
  const blocks: DocumentBlock[] = [];
  let index = 0;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }
    blocks.push({ type: 'paragraph', text: paragraph.join(' ').trim() });
    paragraph = [];
  };

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      index += 1;
      continue;
    }

    const fence = trimmed.match(/^```([\w-]+)?$/);
    if (fence) {
      flushParagraph();
      index += 1;
      const codeLines: string[] = [];
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push({ type: 'code', language: fence[1], text: codeLines.join('\n') });
      continue;
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)$/);
    const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      const items: string[] = [];
      while (index < lines.length) {
        const next = lines[index].trim();
        const match = isOrdered ? next.match(/^\d+\.\s+(.+)$/) : next.match(/^[-*]\s+(.+)$/);
        if (!match) {
          break;
        }
        items.push(match[1]);
        index += 1;
      }
      blocks.push({ type: 'list', ordered: isOrdered, items });
      continue;
    }

    paragraph.push(trimmed);
    index += 1;
  }

  flushParagraph();
  return blocks;
};
