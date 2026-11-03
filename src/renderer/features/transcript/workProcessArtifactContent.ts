import { type ToolContentInput, type UnwrappedToolContent, sanitizeContentText, filterEnvelopeLines } from './workProcessToolContentShared';
import { stringifyPreview, createDetailLines } from './workProcessContentText';

export function unwrapArtifactContent(input: ToolContentInput): UnwrappedToolContent | null {
  const { details, argsRecord, contentText } = input;
  const artifactized = details?.artifactized === true
    || (typeof details?.ref === 'string' && details.ref.startsWith('session://'))
    || (typeof details?.uri === 'string' && details.uri.startsWith('session://'));

if (artifactized) {
    const ref = sanitizeContentText(stringifyPreview(
      details?.ref ?? details?.uri ?? argsRecord?.uri,
    ));
    const hash = sanitizeContentText(stringifyPreview(details?.hash));
    const summary = sanitizeContentText(stringifyPreview(details?.summary)) || contentText;
    const shortHash = hash ? hash.slice(0, 8) : '';
    return {
      previewKind: 'file',
      pathChip: ref || undefined,
      chips: shortHash ? [shortHash] : undefined,
      bodyText: [ref, shortHash].filter(Boolean).join(' · ') || summary || undefined,
      previewLines: summary ? filterEnvelopeLines(createDetailLines(summary, 4)) : [],
    };
  }
  return null;
}
