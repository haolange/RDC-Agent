/** A heading of the card body, in reading order. */
export interface KnowledgeOutlineHeading {
  title: string;
  level: number;
}

const FENCE = /^\s*(```|~~~)/u;

/** The card body without a leading `# Title` that only repeats the card title shown above it. */
export function bodyWithoutTitle(body: string, title: string): string {
  const lines = body.split(/\r?\n/u);
  const first = lines.findIndex((line) => line.trim());
  if (first < 0) return body;
  const heading = /^#\s+(.+)$/u.exec(lines[first].trim());
  return heading && heading[1].trim() === title.trim()
    ? lines
        .slice(first + 1)
        .join('\n')
        .replace(/^\s*\n/u, '')
    : body;
}

/** Markdown headings outside fenced code, in the order the renderer will draw them. */
export function markdownOutline(markdown: string): KnowledgeOutlineHeading[] {
  const headings: KnowledgeOutlineHeading[] = [];
  let fenced = false;
  for (const line of markdown.split(/\r?\n/u)) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    const match = fenced ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line);
    if (match) headings.push({ title: match[2], level: match[1].length });
  }
  return headings;
}
