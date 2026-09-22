import { normalizeToolName, formatMcpTarget } from './workProcessToolCatalog';
import { toRecord, parsePreview, stringifyPreview, createDetailLines, readNestedValue, isLikelyBinaryText, collectReadableText, extractContentTextFromJsonishString, isJsonLike, isEnvelopeText, ENVELOPE_KEY_PATTERN } from './workProcessContentText';
import { getDetailsRecord, getRecordArray } from './workProcessWebPresentation';
import { compactText } from './workProcessFormat';

const SHELL_PREVIEW_MAX_LINES = 20;

const SKILL_DESCRIPTION_MAX = 180;

export const emptyUnwrappedContent = (): UnwrappedToolContent => ({
  previewKind: 'generic',
  previewLines: [],
});

export type UnwrappedToolContent = {
  previewKind: 'shell' | 'skill' | 'file' | 'web' | 'generic';
  previewLines: string[];
  /** Outcome-first collapsed summary when results are available. */
  bodyText?: string;
  /** Short collapsed sample list (search / list-like tools). */
  bodyLines?: string[];
  commandText?: string;
  pathChip?: string;
  chips?: string[];
};

const FILE_TOOL_NAMES = /^(?:read_file|artifact_read|write_file|edit_file|delete_file|move_file|copy_file|read)$/;

/**
 * Strip transport envelopes (`ok` / `data` / `trace_id` / `duration_ms`) and project
 * only the human-readable content layer into previewLines. Full payload stays in raw.
 */
export const unwrapToolContentLayer = (
  toolName: string,
  parsed: unknown,
  raw?: string,
  argsPreview?: string,
): UnwrappedToolContent => {
  const normalized = normalizeToolName(toolName);
  const record = toRecord(parsed);
  const details = getDetailsRecord(record);
  const argsRecord = toRecord(parsePreview(argsPreview));
  const contentText = sanitizeContentText(extractContentLayerText(parsed, raw));

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
        previewLines: ['Binary content omitted from preview.'],
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

  if (normalized === 'skill_read') {
    const description = sanitizeContentText(
      stringifyPreview(details?.description)
      || extractSkillDescription(contentText),
    );
    const pathChip = sanitizeContentText(
      stringifyPreview(
        details?.sourcePath
        ?? details?.path
        ?? record?.sourcePath
        ?? record?.path,
      ),
    );
    const previewLines = description
      ? [compactText(description.replace(/\s+/g, ' ').trim(), SKILL_DESCRIPTION_MAX)]
      : [];
    const skillName = sanitizeContentText(stringifyPreview(
      details?.skillId ?? argsRecord?.skill_id ?? argsRecord?.skillId,
    ));
    return {
      previewKind: 'skill',
      pathChip: pathChip || undefined,
      bodyText: previewLines[0] || undefined,
      previewLines,
      chips: skillName ? [skillName] : undefined,
    };
  }

  if (normalized === 'skills') {
    const names = collectReadableText(record?.skills ?? details?.skills ?? record?.items, 6);
    return {
      previewKind: 'generic',
      chips: names.slice(0, 4),
      bodyText: names.length > 0 ? `${names.length} skills` : contentText || undefined,
      previewLines: names,
    };
  }

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
      bodyText: hits.length > 0 ? `${hits.length} tools` : contentText || undefined,
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

  if (normalized === 'rdc_context' || normalized === 'agent_handoff') {
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
        bodyText = `${matched} file${matched === 1 ? '' : 's'}${truncated ? '+' : ''}`;
      }
    } else {
      const matchedLines = asFiniteNumber(
        details?.matchedLines ?? details?.matched ?? record?.matchedLines ?? record?.matched,
      ) ?? (previewLines.length > 0 ? previewLines.length : undefined);
      const matchedFiles = asFiniteNumber(details?.matchedFiles ?? record?.matchedFiles);
      const parts: string[] = [];
      if (matchedLines != null) parts.push(`${matchedLines} match${matchedLines === 1 ? '' : 'es'}`);
      if (matchedFiles != null) parts.push(`${matchedFiles} file${matchedFiles === 1 ? '' : 's'}`);
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
      ? ['Binary content omitted from preview.']
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
      bodyText = `${bodyText} · ${totalLines} lines`;
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

  if (normalized === 'web_search' || normalized === 'web_fetch') {
    const detailsKind = stringifyPreview(details?.kind);
    if (normalized === 'web_search' || detailsKind === 'search') {
      const resultCount = asFiniteNumber(
        details?.resultCount
        ?? record?.resultCount
        ?? (Array.isArray(details?.results) ? details.results.length : undefined),
      );
      const query = stringifyPreview(argsRecord?.query ?? details?.query ?? record?.query);
      const countLabel = resultCount != null
        ? `${String(resultCount)} 来源`
        : '来源';
      const summary = query
        ? `${countLabel}的 “${compactText(query, 36)}”`
        : countLabel;
      const enhanced = enhanceToolPreviewLines(
        toolName,
        parsed,
        contentText || undefined,
        filterEnvelopeLines(createDetailLines(contentText, 3)),
      );
      return {
        previewKind: 'web',
        bodyText: summary,
        previewLines: filterEnvelopeLines([summary, ...enhanced.filter((line) => line !== summary)]).slice(0, 8),
      };
    }

    const status = asFiniteNumber(details?.status ?? record?.status);
    const bytes = asFiniteNumber(details?.bytes ?? record?.bytes);
    const statusBits: string[] = [];
    if (status != null) statusBits.push(`HTTP ${status}`);
    if (bytes != null) statusBits.push(`${bytes} bytes`);
    const enhanced = enhanceToolPreviewLines(
      toolName,
      parsed,
      contentText || undefined,
      filterEnvelopeLines(createDetailLines(contentText, 3)),
    );
    const previewLines = filterEnvelopeLines([
      ...(statusBits.length > 0 ? [statusBits.join(' · ')] : []),
      ...enhanced,
    ]);
    return {
      previewKind: 'web',
      bodyText: statusBits.length > 0 ? statusBits.join(' · ') : undefined,
      previewLines,
    };
  }

  const previewLineLimit = 6;
  const baseLines = contentText
    ? createDetailLines(contentText, previewLineLimit)
    : extractReadableResultLines(parsed, undefined, previewLineLimit);
  const binarySafe = isLikelyBinaryText(baseLines.join('\n'))
    ? ['Binary content omitted from preview.']
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
};

const asFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
};

const extractContentLayerText = (parsed: unknown, raw?: string): string => {
  const collected = collectReadableText(parsed, 40);
  if (collected.length > 0) {
    return collected.join('\n');
  }
  if (typeof parsed === 'string') {
    const extracted = extractContentTextFromJsonishString(parsed);
    if (extracted) return extracted;
    if (!isEnvelopeText(parsed)) return parsed;
  }
  if (raw) {
    const extracted = extractContentTextFromJsonishString(raw);
    if (extracted) return extracted;
    if (!isEnvelopeText(raw) && !isJsonLike(raw)) return raw;
  }
  return '';
};

const extractSkillDescription = (contentText: string): string => {
  const text = contentText.trim();
  if (!text) return '';
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(text);
  if (frontmatter) {
    const descMatch = /(?:^|\n)description:\s*(?:>-?\s*)?([^\n]+)/i.exec(frontmatter[1]);
    if (descMatch?.[1]) return descMatch[1].trim().replace(/^['"]|['"]$/g, '');
    const body = frontmatter[2].trim();
    if (body) {
      const paragraph = body.split(/\n\s*\n/).map((part) => part.replace(/^#+\s+.*/gm, '').trim()).find(Boolean);
      if (paragraph) return paragraph;
    }
  }
  const paragraph = text
    .split(/\n\s*\n/)
    .map((part) => part.replace(/^#+\s+.*/gm, '').replace(/\s+/g, ' ').trim())
    .find((part) => part && !part.startsWith('---'));
  return paragraph ?? '';
};

export const sanitizeContentText = (value: string): string => {
  if (!value) return '';
  return value
    // eslint-disable-next-line no-control-regex -- Tool output sanitization intentionally removes NUL bytes.
    .replace(/\u0000/g, '')
    .replace(/\uFFFD/g, '')
    // eslint-disable-next-line no-control-regex -- Tool output sanitization intentionally removes unsafe C0 controls.
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, '');
};

const filterEnvelopeLines = (lines: string[]): string[] => (
  lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (ENVELOPE_KEY_PATTERN.test(trimmed.replace(/[",:]/g, '').split(/\s+/)[0] ?? '')) return false;
    if (/^[{[]/.test(trimmed) && /"(?:ok|trace_id|duration_ms)"\s*:/.test(trimmed)) return false;
    if (/^\s*"(?:ok|data|artifacts|trace_id|duration_ms)"\s*:/.test(trimmed)) return false;
    return true;
  })
);

const extractReadableResultLines = (parsed: unknown, raw?: string, maxLines = 3): string[] => {
  const collected = collectReadableText(parsed, maxLines);
  if (collected.length > 0) return collected.slice(0, maxLines);
  // Never dump the transport envelope into preview; raw tier owns the full payload.
  if (raw && !isEnvelopeText(raw) && !isJsonLike(raw)) {
    return createDetailLines(raw, maxLines);
  }
  return [];
};

const enhanceToolPreviewLines = (
  toolName: string,
  parsed: unknown,
  contentRaw: string | undefined,
  previewLines: string[],
): string[] => {
  const normalized = normalizeToolName(toolName);
  const record = toRecord(parsed);

  if (normalized === 'shell' || normalized.includes('shell')) {
    const stdout = stringifyPreview(
      record?.stdout
      ?? readNestedValue(record ?? {}, ['result', 'stdout'])
      ?? contentRaw,
    );
    const lines = filterEnvelopeLines(createDetailLines(stdout, SHELL_PREVIEW_MAX_LINES));
    if (lines.length > 0) return lines;
  }

  if (/grep|glob/.test(normalized)) {
    const matches = collectReadableText(
      record?.matches ?? record?.files ?? record?.paths ?? readNestedValue(record ?? {}, ['data', 'matches']),
      4,
    );
    if (matches.length > 0) return matches;
  }

  if (/read_file|^read$/.test(normalized)) {
    const lineCount = record?.lineCount
      ?? record?.lines
      ?? record?.totalLines
      ?? readNestedValue(record ?? {}, ['meta', 'lineCount'])
      ?? readNestedValue(record ?? {}, ['data', 'details', 'totalLines'])
      ?? readNestedValue(record ?? {}, ['data', 'details', 'lineCount']);
    if (lineCount !== undefined && lineCount !== null) {
      return [`${String(lineCount)} lines`, ...previewLines].filter(Boolean).slice(0, 4);
    }
  }

  if (normalized.startsWith('git_')) {
    const summary = stringifyPreview(record?.summary ?? record?.status ?? record?.output ?? contentRaw);
    const lines = filterEnvelopeLines(createDetailLines(summary, 3));
    if (lines.length > 0) return lines;
  }

  if (/web_fetch|web_search/.test(normalized)) {
    const details = getDetailsRecord(record);
    if (details?.kind === 'search' || normalized === 'web_search') {
      const resultRecords = getRecordArray(
        details?.results
        ?? record?.results
        ?? readNestedValue(record ?? {}, ['data', 'details', 'results']),
      );
      const resultLines = resultRecords.slice(0, 3).flatMap((result, index) => {
        const title = stringifyPreview(result.title);
        const url = stringifyPreview(result.url);
        const source = stringifyPreview(result.source ?? result.domain);
        const publishedAt = stringifyPreview(result.publishedAt ?? result.date);
        return [
          title ? `${index + 1}. ${title}` : '',
          url,
          source || publishedAt ? [source ? `Source: ${source}` : '', publishedAt ? `Date: ${publishedAt}` : ''].filter(Boolean).join(' / ') : '',
        ].filter(Boolean);
      });
      const lines = [
        stringifyPreview(details?.provider) ? `Provider: ${stringifyPreview(details?.provider)}` : '',
        stringifyPreview(details?.resultCount) ? `Results: ${stringifyPreview(details?.resultCount)}` : '',
        ...resultLines,
      ].filter(Boolean);
      if (lines.length > 0) return lines.slice(0, 8);
    }

    const status = stringifyPreview(details?.status ?? record?.status ?? record?.statusCode);
    const statusText = stringifyPreview(details?.statusText ?? record?.statusText);
    const url = stringifyPreview(details?.url ?? record?.url ?? readNestedValue(record ?? {}, ['data', 'details', 'url']));
    const lines = [
      status ? `HTTP ${status}${statusText ? ` ${statusText}` : ''}` : '',
      url,
    ].filter(Boolean);
    if (lines.length > 0) return [...lines, ...previewLines].slice(0, 4);
  }

  if (normalized.startsWith('task_') || normalized.startsWith('memory_')) {
    const taskRecord = Array.isArray(record?.tasks) ? toRecord(record.tasks[0]) : null;
    const summary = stringifyPreview(
      record?.subject
      ?? record?.name
      ?? record?.taskId
      ?? record?.id
      ?? record?.title
      ?? taskRecord?.subject
      ?? taskRecord?.name
      ?? taskRecord?.title,
    );
    if (summary) return [summary, ...previewLines].slice(0, 3);
  }

  return previewLines;
};
