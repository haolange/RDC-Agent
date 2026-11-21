import { type ToolContentInput, type UnwrappedToolContent, sanitizeContentText, filterEnvelopeLines } from './workProcessToolContentShared';
import { stringifyPreview, createDetailLines, toRecord } from './workProcessContentText';

/** Offload receipt lines (the session address, its hash, read hints) belong to the raw receipt, never the card. */
const isReceiptLine = (line: string): boolean => /^(?:ref|hash|sha256|Evidence ref|Decoded tool text|Image evidence)\b|session:\/\/|^\{"uri":/i.test(line.trim());

/**
 * A result moved into a session file still reads as what the tool did: the offload kept a display gist (the page, the
 * query, the command, the file) and the card renders that. The session address and hash stay in the raw receipt only.
 * A record from before the gist existed shows the tool's verb and time and nothing else.
 */
export function unwrapArtifactContent(input: ToolContentInput): UnwrappedToolContent | null {
  const { details, contentText } = input;
  const artifactized = details?.artifactized === true
    || (typeof details?.ref === 'string' && details.ref.startsWith('session://'))
    || (typeof details?.uri === 'string' && details.uri.startsWith('session://'));
  if (!artifactized) return null;

  const summary = sanitizeContentText(stringifyPreview(details?.summary)) || contentText;
  const previewLines = summary ? filterEnvelopeLines(createDetailLines(summary, 4)).filter((line) => !isReceiptLine(line)) : [];
  const display = toRecord(details?.display);
  if (display?.kind === 'command' && typeof display.command === 'string') {
    return { previewKind: 'shell', commandText: display.command, bodyText: display.command, previewLines };
  }
  if (display?.kind === 'file' && typeof display.path === 'string') {
    return { previewKind: 'file', pathChip: display.path, previewLines };
  }
  // Pages and queries come from the same gist through the web presentation.
  return { previewKind: display ? 'web' : 'generic', previewLines };
}
