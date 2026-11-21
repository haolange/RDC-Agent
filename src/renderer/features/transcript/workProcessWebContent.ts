import type { ToolContentInput, UnwrappedToolContent } from './workProcessToolContentShared';

/**
 * Reads and searches render from the web presentation (pages, query, HTTP facts in the details). The tool's text is a
 * metadata block — address, status, byte counts, hashes — that belongs to the raw receipt, so no text lines are lifted.
 */
export function unwrapWebContent(input: ToolContentInput): UnwrappedToolContent | null {
  if (input.normalized !== 'web_search' && input.normalized !== 'web_fetch') return null;
  return { previewKind: 'web', previewLines: [] };
}
