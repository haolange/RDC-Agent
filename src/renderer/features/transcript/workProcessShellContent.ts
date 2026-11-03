import { type ToolContentInput, type UnwrappedToolContent, SHELL_PREVIEW_MAX_LINES, sanitizeContentText, filterEnvelopeLines } from './workProcessToolContentShared';
import { stringifyPreview, createDetailLines, readNestedValue, isLikelyBinaryText } from './workProcessContentText';

export function unwrapShellContent(input: ToolContentInput): UnwrappedToolContent | null {
  const { t, normalized, record, details, argsRecord, contentText } = input;
  if (normalized === 'shell' || normalized.includes('shell')) {
    const commandText = sanitizeContentText(
      stringifyPreview(
        argsRecord?.command
        ?? readNestedValue(argsRecord ?? {}, ['rdc', 'operation'])
        ?? argsRecord?.cmd
        ?? details?.command
        ?? record?.command
        ?? readNestedValue(record ?? {}, ['data', 'details', 'command']),
      ),
    );
    const stdout = sanitizeContentText(
      stringifyPreview(
        record?.stdout
        ?? readNestedValue(record ?? {}, ['result', 'stdout'])
        ?? details?.stdout,
      ) || contentText,
    );
    if (isLikelyBinaryText(stdout)) {
      return {
        previewKind: 'shell',
        commandText: commandText || undefined,
        previewLines: [t('chat.binaryPreviewOmitted')],
      };
    }
    const previewLines = filterEnvelopeLines(createDetailLines(stdout, SHELL_PREVIEW_MAX_LINES));
    return {
      previewKind: 'shell',
      commandText: commandText || undefined,
      previewLines,
    };
  }

if (normalized === 'code_interpreter') {
    const code = sanitizeContentText(stringifyPreview(argsRecord?.code ?? details?.code));
    const previewLines = filterEnvelopeLines(createDetailLines(contentText, SHELL_PREVIEW_MAX_LINES));
    return {
      previewKind: 'shell',
      commandText: code || undefined,
      bodyText: code || contentText || undefined,
      previewLines,
    };
  }
  return null;
}
