import { type ToolContentInput, type UnwrappedToolContent, asFiniteNumber, sanitizeContentText, filterEnvelopeLines } from './workProcessToolContentShared';
import { formatMcpTarget, toolDisplayName } from './workProcessToolCatalog';
import { stringifyPreview, createDetailLines, readNestedValue, collectReadableText } from './workProcessContentText';
import { compactText } from './workProcessFormat';

/** A memory operation: its key or query and scope as chips, the found text as lines. */
export function presentMemoryContent(input: ToolContentInput): UnwrappedToolContent {
  const { details, argsRecord, contentText } = input;
  const subject = sanitizeContentText(stringifyPreview(
    argsRecord?.key ?? argsRecord?.query ?? details?.key ?? details?.query ?? argsRecord?.path,
  ));
  const scope = sanitizeContentText(stringifyPreview(argsRecord?.scope ?? details?.scope));
  const chips = [subject, scope].filter(Boolean);
  const previewLines = filterEnvelopeLines(createDetailLines(contentText, 6));
  return {
    previewKind: 'generic',
    chips,
    bodyText: previewLines[0] || subject || undefined,
    previewLines,
  };
}

/** An MCP tool: its server and tool as chips, a path when it names one, the text as lines. */
export function presentMcpContent(input: ToolContentInput): UnwrappedToolContent {
  const { toolName, details, argsRecord, contentText } = input;
  const target = formatMcpTarget(toolName);
  const [server, tool] = target.split('/');
  const chips = [server ? `MCP · ${server}` : 'MCP', tool].filter(Boolean);
  const previewLines = filterEnvelopeLines(createDetailLines(contentText, 6));
  const pathChip = sanitizeContentText(stringifyPreview(argsRecord?.path ?? details?.path));
  return {
    previewKind: 'generic',
    chips,
    pathChip: pathChip || undefined,
    bodyText: previewLines[0] || target || undefined,
    previewLines,
  };
}

/** Found tools, read by what they do. */
export function presentToolSearchContent(input: ToolContentInput): UnwrappedToolContent {
  const { t, record, details } = input;
  // Found tools read by what they do, never by their wire names.
  const hits = collectReadableText(record?.matches ?? record?.tools ?? details?.matches, 8).map((name) => toolDisplayName(name, t));
  return {
    previewKind: 'generic',
    bodyText: hits.length > 0 ? t(hits.length === 1 ? 'chat.previewToolsOne' : 'chat.previewToolsMany', { count: hits.length }) : undefined,
    bodyLines: hits.slice(0, 3),
    previewLines: hits,
  };
}

/** A registered output or plan: the file it wrote. */
export function presentOutputContent(input: ToolContentInput): UnwrappedToolContent {
  const { details, argsRecord, contentText } = input;
  const pathChip = sanitizeContentText(stringifyPreview(
    argsRecord?.path ?? details?.path ?? details?.outputPath,
  ));
  return {
    previewKind: 'generic',
    pathChip: pathChip || undefined,
    bodyText: pathChip || contentText || undefined,
    previewLines: filterEnvelopeLines(createDetailLines(contentText, 6)),
  };
}

/** The runtime context: what it means for replay, not its identity payload. */
export function presentRuntimeContextContent(input: ToolContentInput): UnwrappedToolContent {
  const { t, details } = input;
  // The payload is identity for the model (session, scope, capture hashes); people see what it means for replay.
  const state = details?.available === true ? 'replayReady' : details?.requiresRecovery === true ? 'replayRecovery'
    : details?.available === false ? 'noCapture' : null;
  return {
    previewKind: 'generic',
    bodyText: state ? t(`chat.runtimeContext.${state}`) : undefined,
    previewLines: [],
  };
}

/** A file search: the matches as lines and how many there are. */
export function presentFileSearchContent(input: ToolContentInput): UnwrappedToolContent {
  const { t, normalized, record, details, contentText } = input;
  const fromContent = contentText ? createDetailLines(contentText, 8) : [];
  const fromMatches = collectReadableText(
    record?.matches
    ?? record?.files
    ?? record?.paths
    ?? readNestedValue(record ?? {}, ['data', 'matches'])
    ?? readNestedValue(record ?? {}, ['data', 'files']),
    8,
  );
  const previewLines = filterEnvelopeLines(fromContent.length > 0 ? fromContent : fromMatches);
  const truncated = Boolean(details?.truncated ?? record?.truncated);

  let bodyText = '';
  if (normalized === 'glob') {
    const matched = asFiniteNumber(details?.matched ?? record?.matched) ?? (
      previewLines.length > 0 ? previewLines.length : undefined
    );
    if (matched != null) {
      bodyText = `${t(matched === 1 ? 'chat.previewFilesOne' : 'chat.previewFilesMany', { count: matched })}${truncated ? '+' : ''}`;
    }
  } else {
    const matchedLines = asFiniteNumber(
      details?.matchedLines ?? details?.matched ?? record?.matchedLines ?? record?.matched,
    ) ?? (previewLines.length > 0 ? previewLines.length : undefined);
    const matchedFiles = asFiniteNumber(details?.matchedFiles ?? record?.matchedFiles);
    const parts: string[] = [];
    if (matchedLines != null) parts.push(t(matchedLines === 1 ? 'chat.previewMatchesOne' : 'chat.previewMatchesMany', { count: matchedLines }));
    if (matchedFiles != null) parts.push(t(matchedFiles === 1 ? 'chat.previewFilesOne' : 'chat.previewFilesMany', { count: matchedFiles }));
    bodyText = parts.join(' · ');
    if (truncated && bodyText) bodyText += '+';
  }

  const bodyLines = previewLines.slice(0, 3);
  if (!bodyText && bodyLines.length > 0) {
    bodyText = bodyLines.length === 1
      ? bodyLines[0]
      : `${compactText(bodyLines[0], 48)} · +${previewLines.length - 1}`;
  }

  return {
    previewKind: 'generic',
    bodyText: bodyText || undefined,
    bodyLines: bodyLines.length > 0 ? bodyLines : undefined,
    previewLines,
  };
}
