import type { UnwrappedToolContent } from './workProcessToolContentShared';

/**
 * Reads and searches render from the web presentation (pages, query, HTTP facts in the details). The tool's text is a
 * metadata block — address, status, byte counts, hashes — that belongs to the raw receipt, so no text lines are lifted.
 */
export function presentWebContent(): UnwrappedToolContent {
  return { previewKind: 'web', previewLines: [] };
}
