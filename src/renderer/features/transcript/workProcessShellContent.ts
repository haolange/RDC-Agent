import { type ToolContentInput, type UnwrappedToolContent, SHELL_PREVIEW_MAX_LINES, sanitizeContentText, filterEnvelopeLines } from './workProcessToolContentShared';
import { stringifyPreview, createDetailLines, readNestedValue, isLikelyBinaryText } from './workProcessContentText';

/** A shell command (any tool named like one): the command and its output; binary output is left out. */
export function presentShellContent(input: ToolContentInput): UnwrappedToolContent {
  const { t, record, details, argsRecord, contentText } = input;
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

/** Interpreted code: the code as the command and the body, its output as preview lines. */
export function presentInterpreterContent(input: ToolContentInput): UnwrappedToolContent {
  const { details, argsRecord, contentText } = input;
  const code = sanitizeContentText(stringifyPreview(argsRecord?.code ?? details?.code));
  const previewLines = filterEnvelopeLines(createDetailLines(contentText, SHELL_PREVIEW_MAX_LINES));
  return {
    previewKind: 'shell',
    commandText: code || undefined,
    bodyText: code || contentText || undefined,
    previewLines,
  };
}
