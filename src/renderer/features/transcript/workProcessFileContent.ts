import { type ToolContentInput, type UnwrappedToolContent, FILE_TOOL_NAMES, asFiniteNumber, sanitizeContentText, filterEnvelopeLines, extractReadableResultLines, enhanceToolPreviewLines } from './workProcessToolContentShared';
import { stringifyPreview, createDetailLines, readNestedValue, isLikelyBinaryText } from './workProcessContentText';

export function unwrapFileContent(input: ToolContentInput): UnwrappedToolContent | null {
  const { toolName, parsed, t, normalized, record, details, argsRecord, contentText } = input;
  if (FILE_TOOL_NAMES.test(normalized)) {
    const pathChip = sanitizeContentText(
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
    let bodyText = pathChip || undefined;
    if (isRead && bodyText && totalLines != null) {
      bodyText = `${bodyText} · ${t(totalLines === 1 ? 'chat.previewLineOne' : 'chat.previewLines', { count: totalLines })}`;
    } else if (!isRead && previewLines.length > 0 && !bodyText) {
      bodyText = previewLines[0];
    }

    return {
      previewKind: 'file',
      pathChip: pathChip || undefined,
      bodyText,
      previewLines,
    };
  }
  return null;
}
