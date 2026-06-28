const PSEUDO_BULLET_PATTERN = /^(\s*)[◦•·▪▫‣⁃]\s+/u;
const ORDERED_PSEUDO_PATTERN = /^(\s*)\d+[.)]\s+/;
const LIST_ITEM_PATTERN = /^(\s*)(?:[-*+]|\d+[.)])\s+/;
const SECTION_HEADING_PATTERN = /^(总结|结论|Summary|Conclusion)[：:]\s*$/i;

const isListItemLine = (line: string): boolean => LIST_ITEM_PATTERN.test(line);

const promoteSectionHeading = (line: string): string => {
  const trimmed = line.trim();
  const match = trimmed.match(SECTION_HEADING_PATTERN);
  if (!match) return line;
  const label = match[1] ?? '总结';
  return `### ${label}`;
};

const collapseBlankLines = (lines: string[]): string[] => {
  const output: string[] = [];
  let blankRun = 0;
  for (const line of lines) {
    if (!line.trim()) {
      blankRun += 1;
      if (blankRun <= 1) output.push('');
      continue;
    }
    blankRun = 0;
    output.push(line);
  }
  return output;
};

const glueListItemBlanks = (lines: string[]): string[] => {
  const output: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      const prev = output[output.length - 1];
      let lookahead = index + 1;
      while (lookahead < lines.length && !lines[lookahead].trim()) {
        lookahead += 1;
      }
      const next = lines[lookahead];
      if (prev && next && isListItemLine(prev) && isListItemLine(next)) {
        continue;
      }
    }
    output.push(line);
  }
  return output;
};

/**
 * 将模型常见的伪列表行首符号规范为 GFM 列表，避免每条落成独立段落。
 * 不修改 fenced code block 内容。
 */
export function normalizeAssistantMarkdown(content: string): string {
  if (!content.trim()) return content;

  const lines = content.split('\n');
  const transformed: string[] = [];
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      transformed.push(line);
      continue;
    }

    if (inFence) {
      transformed.push(line);
      continue;
    }

    const pseudoMatch = line.match(PSEUDO_BULLET_PATTERN);
    if (pseudoMatch) {
      const indent = pseudoMatch[1] ?? '';
      const body = line.replace(PSEUDO_BULLET_PATTERN, '').trimStart();
      transformed.push(`${indent}- ${body}`);
      continue;
    }

    const orderedMatch = line.match(ORDERED_PSEUDO_PATTERN);
    if (orderedMatch && !line.trimStart().startsWith('-')) {
      const indent = orderedMatch[1] ?? '';
      const body = line.replace(ORDERED_PSEUDO_PATTERN, '').trimStart();
      const number = line.trim().match(/^(\d+)/)?.[1] ?? '1';
      transformed.push(`${indent}${number}. ${body}`);
      continue;
    }

    transformed.push(promoteSectionHeading(line));
  }

  return glueListItemBlanks(collapseBlankLines(transformed))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
