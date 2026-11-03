import { type ToolContentInput, type UnwrappedToolContent, asFiniteNumber, sanitizeContentText, filterEnvelopeLines } from './workProcessToolContentShared';
import { formatMcpTarget } from './workProcessToolCatalog';
import { stringifyPreview, createDetailLines, readNestedValue, collectReadableText } from './workProcessContentText';
import { compactText } from './workProcessFormat';

export function unwrapCatalogContent(input: ToolContentInput): UnwrappedToolContent | null {
  const { toolName, t, normalized, record, details, argsRecord, contentText } = input;
  if (normalized.startsWith('memory_')) {
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

if (normalized === 'mcp' || normalized.startsWith('mcp__')) {
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

if (normalized === 'tool_search') {
    const hits = collectReadableText(record?.matches ?? record?.tools ?? details?.matches, 8);
    return {
      previewKind: 'generic',
      bodyText: hits.length > 0 ? t(hits.length === 1 ? 'chat.previewToolsOne' : 'chat.previewToolsMany', { count: hits.length }) : contentText || undefined,
      bodyLines: hits.slice(0, 3),
      previewLines: hits,
    };
  }

if (normalized === 'output_register' || normalized === 'plan_artifact') {
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

if (normalized === 'runtime_context') {
    const target = sanitizeContentText(stringifyPreview(
      argsRecord?.target ?? argsRecord?.agent ?? details?.target,
    ));
    return {
      previewKind: 'generic',
      chips: target ? [target] : undefined,
      bodyText: contentText || target || undefined,
      previewLines: filterEnvelopeLines(createDetailLines(contentText, 6)),
    };
  }

if (normalized === 'glob' || normalized === 'grep') {
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
  return null;
}
