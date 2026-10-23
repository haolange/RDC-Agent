import { SessionArtifactError } from '@shared/types/sessionArtifact';

export const ARTIFACT_TEXT_SEARCH_MAX_MATCHES = 64;
export interface ArtifactTextSearch {
  query: string;
  totalMatches: number;
  returnedMatches: number;
}
interface Match { line: number; column: number; excerpt: string; excerptColumn: number }
interface Cursor { offset: number; column: number }

/** Literal data search, never regex/code execution; counts the whole selected bounded text. */
export function searchArtifactText(text: string, query: string, cursor: Cursor, limit: number, maxBytes: number) {
  if (typeof query !== 'string' || query.length === 0 || query.length > 256 || /[\r\n]/.test(query)
    || Buffer.from(query, 'utf8').toString('utf8') !== query) {
    throw new SessionArtifactError('ARTIFACT_URI_INVALID', 'Search must be a nonempty single-line literal of at most 256 UTF-16 characters.');
  }
  const matches: Match[] = [];
  const matchLimit = Math.min(limit, ARTIFACT_TEXT_SEARCH_MAX_MATCHES);
  let totalMatches = 0;
  let afterCursor = 0;
  let next: Cursor | undefined;
  for (const [index, line] of text.split('\n').entries()) {
    let column = line.indexOf(query);
    while (column !== -1) {
      totalMatches += 1;
      if (index + 1 > cursor.offset || (index + 1 === cursor.offset && column >= cursor.column)) {
        afterCursor += 1;
        if (matches.length < matchLimit) {
          let start = Math.max(0, column - 40);
          let end = Math.min(line.length, column + query.length + 80);
          if (/[\uDC00-\uDFFF]/.test(line[start] ?? '')) start -= 1;
          if (/[\uDC00-\uDFFF]/.test(line[end] ?? '')) end -= 1;
          matches.push({ line: index + 1, column, excerpt: line.slice(start, end), excerptColumn: start });
        } else if (!next) next = { offset: index + 1, column };
      }
      column = line.indexOf(query, column + query.length);
    }
  }
  const render = () => JSON.stringify({ query, totalMatches, afterCursor, matches, ...(next ? { next } : {}) });
  let body = render();
  while (matches.length && Buffer.byteLength(body) > maxBytes) {
    const removed = matches.pop()!;
    next = { offset: removed.line, column: removed.column };
    body = render();
  }
  if (Buffer.byteLength(body) > maxBytes || (afterCursor > 0 && matches.length === 0)) {
    throw new SessionArtifactError('ARTIFACT_URI_INVALID', 'Output byte bound is too small for a search match; increase maxBytes.');
  }
  return { text: body, next, search: { query, totalMatches, returnedMatches: matches.length } satisfies ArtifactTextSearch };
}
