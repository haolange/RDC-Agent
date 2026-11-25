import { type ToolContentInput, type UnwrappedToolContent, asFiniteNumber, sanitizeContentText, filterEnvelopeLines, extractReadableResultLines, enhanceToolPreviewLines } from './workProcessToolContentShared';
import { stringifyPreview, createDetailLines, readNestedValue, isLikelyBinaryText, isInternalAddress } from './workProcessContentText';

/** A file operation: the path it worked on (never an internal address) and, for a read, its first lines and length. */
export function presentFileContent(input: ToolContentInput): UnwrappedToolContent {
  const { toolName, parsed, t, normalized, record, details, argsRecord, contentText } = input;
  const address = sanitizeContentText(
    stringifyPreview(
      argsRecord?.uri
      ?? argsRecord?.ref
      ?? argsRecord?.path
      ?? argsRecord?.file
      ?? argsRecord?.filePath
      ?? argsRecord?.filepath
      ?? argsRecord?.destination
      ?? argsRecord?.dest
      ?? argsRecord?.source
      ?? details?.uri
      ?? details?.ref
      ?? details?.path
      ?? record?.path,
    ),
  );
  const pathChip = isInternalAddress(address) ? '' : address;
  const isRead = /read_file|^read$/i.test(normalized);
  const previewLineLimit = isRead ? 4 : 3;
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
  const totalLines = asFiniteNumber(
    details?.totalLines
    ?? details?.lineCount
    ?? record?.totalLines
    ?? record?.lineCount
    ?? readNestedValue(record ?? {}, ['meta', 'lineCount']),
  );
  // The title names the file and the details show its path, so the caption only adds how long a read file is.
  const bodyText = isRead && totalLines != null
    ? t(totalLines === 1 ? 'chat.previewLineOne' : 'chat.previewLines', { count: totalLines })
    : undefined;

  return {
    previewKind: 'file',
    pathChip: pathChip || undefined,
    bodyText,
    previewLines,
  };
}
