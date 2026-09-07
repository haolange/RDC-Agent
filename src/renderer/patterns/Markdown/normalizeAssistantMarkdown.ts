const FENCE_MARKER = '\u0060\u0060\u0060';
const PSEUDO_BULLET_PATTERN = /^(\s*)[\u25e6\u2022\u00b7\u25aa\u25ab\u2023\u2043]\s+/u;
const ORDERED_PSEUDO_PATTERN = /^(\s*)\d+[.)]\s+/;
const LIST_ITEM_PATTERN = /^(\s*)(?:[-*+]|\d+[.)])\s+/;
const SECTION_HEADING_PATTERN = /^(\u603b\u7ed3|\u7ed3\u8bba|Summary|Conclusion)[\uff1a:]\s*$/i;

interface MarkdownLine {
  text: string;
  fenced: boolean;
}

interface ListInfo {
  indent: number;
}

const getIndent = (line: string): number => line.match(/^\s*/)?.[0].length ?? 0;

const getListInfo = (line: string): ListInfo | null => {
  const match = line.match(LIST_ITEM_PATTERN);
  return match ? { indent: match[1]?.length ?? 0 } : null;
};

const promoteSectionHeading = (line: string): string => {
  const trimmed = line.trim();
  const match = trimmed.match(SECTION_HEADING_PATTERN);
  if (!match) return line;
  return '### ' + (match[1] ?? 'Summary');
};

const transformNonFencedLine = (line: string): string => {
  const pseudoMatch = line.match(PSEUDO_BULLET_PATTERN);
  if (pseudoMatch) {
    const indent = pseudoMatch[1] ?? '';
    const body = line.replace(PSEUDO_BULLET_PATTERN, '').trimStart();
    return indent + '- ' + body;
  }

  const orderedMatch = line.match(ORDERED_PSEUDO_PATTERN);
  if (orderedMatch && !line.trimStart().startsWith('-')) {
    const indent = orderedMatch[1] ?? '';
    const body = line.replace(ORDERED_PSEUDO_PATTERN, '').trimStart();
    const number = line.trim().match(/^(\d+)/)?.[1] ?? '1';
    return indent + number + '. ' + body;
  }

  return promoteSectionHeading(line);
};

const previousNonBlank = (lines: MarkdownLine[]): MarkdownLine | null => {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].text.trim()) return lines[index];
  }
  return null;
};

const nextNonBlank = (lines: MarkdownLine[], startIndex: number): MarkdownLine | null => {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (lines[index].text.trim()) return lines[index];
  }
  return null;
};

const isListContinuation = (previous: string, next: string): boolean => {
  const previousList = getListInfo(previous);
  if (!previousList) return false;
  const nextList = getListInfo(next);
  if (nextList) return true;
  return getIndent(next) > previousList.indent;
};

const normalizeSpacing = (lines: MarkdownLine[]): MarkdownLine[] => {
  const output: MarkdownLine[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.fenced || line.text.trim()) {
      output.push(line);
      continue;
    }

    const previous = previousNonBlank(output);
    const next = nextNonBlank(lines, index + 1);
    if (
      previous
      && next
      && !previous.fenced
      && !next.fenced
      && isListContinuation(previous.text, next.text)
    ) {
      continue;
    }

    const last = output[output.length - 1];
    if (last && !last.fenced && !last.text.trim()) {
      continue;
    }
    output.push(line);
  }

  return output;
};

export function normalizeAssistantMarkdown(content: string): string {
  if (!content.trim()) return content;

  const lines = content.split('\n');
  const transformed: MarkdownLine[] = [];
  let inFence = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(FENCE_MARKER)) {
      transformed.push({ text: line, fenced: true });
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      transformed.push({ text: line, fenced: true });
      continue;
    }

    transformed.push({ text: transformNonFencedLine(line), fenced: false });
  }

  return normalizeSpacing(transformed)
    .map((line) => line.text)
    .join('\n')
    .trim();
}
