import { type ToolContentInput, type UnwrappedToolContent, asFiniteNumber, filterEnvelopeLines, extractReadableResultLines, enhanceToolPreviewLines } from './workProcessToolContentShared';
import { createDetailLines, isLikelyBinaryText } from './workProcessContentText';
import { compactText } from './workProcessFormat';

export function unwrapGenericContent(input: ToolContentInput): UnwrappedToolContent {
  const { toolName, parsed, t, record, details, contentText } = input;
  const previewLineLimit = 6;

const baseLines = contentText
    ? createDetailLines(contentText, previewLineLimit)
    : extractReadableResultLines(parsed, undefined, previewLineLimit);

const binarySafe = isLikelyBinaryText(baseLines.join('\n'))
    ? [t('chat.binaryPreviewOmitted')]
    : filterEnvelopeLines(baseLines);

const previewLines = filterEnvelopeLines(enhanceToolPreviewLines(
    toolName,
    parsed,
    contentText || undefined,
    binarySafe,
  ));

const total = asFiniteNumber(
    details?.total
    ?? details?.matched
    ?? details?.count
    ?? record?.total
    ?? record?.matched,
  );

const bodyLines = previewLines.slice(0, 3);

let bodyText = total != null ? `${total} items` : undefined;

if (!bodyText && previewLines[0]) {
    bodyText = compactText(previewLines[0].replace(/\s+/g, ' ').trim(), 72);
  }

return {
    previewKind: 'generic',
    bodyText,
    bodyLines: bodyLines.length > 0 ? bodyLines : undefined,
    previewLines,
  };
  
}
