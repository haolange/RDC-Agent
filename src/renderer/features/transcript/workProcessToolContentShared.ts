import type { Translator } from '../../i18n/messages';
import { normalizeToolName } from './workProcessToolCatalog';
import { toRecord, stringifyPreview, createDetailLines, readNestedValue, collectReadableText, extractContentTextFromJsonishString, isJsonLike, isEnvelopeText, ENVELOPE_KEY_PATTERN } from './workProcessContentText';
import { getDetailsRecord, getRecordArray } from './workProcessWebPresentation';

export interface ToolContentInput {
  toolName: string;
  parsed: unknown;
  raw: string | undefined;
  argsPreview: string | undefined;
  t: Translator;
  normalized: string;
  record: ReturnType<typeof toRecord>;
  details: ReturnType<typeof getDetailsRecord>;
  argsRecord: ReturnType<typeof toRecord>;
  contentText: string;
}

export const SHELL_PREVIEW_MAX_LINES = 20;

export const SKILL_DESCRIPTION_MAX = 180;

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

export const FILE_TOOL_NAMES = /^(?:read_file|artifact_read|write_file|edit_file|delete_file|move_file|copy_file|read)$/;
export const asFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
};

export const extractContentLayerText = (parsed: unknown, raw?: string): string => {
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

export const extractSkillDescription = (contentText: string): string => {
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

export const filterEnvelopeLines = (lines: string[]): string[] => (
  lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (ENVELOPE_KEY_PATTERN.test(trimmed.replace(/[",:]/g, '').split(/\s+/)[0] ?? '')) return false;
    if (/^[{[]/.test(trimmed) && /"(?:ok|trace_id|duration_ms)"\s*:/.test(trimmed)) return false;
    if (/^\s*"(?:ok|data|artifacts|trace_id|duration_ms)"\s*:/.test(trimmed)) return false;
    return true;
  })
);

export const extractReadableResultLines = (parsed: unknown, raw?: string, maxLines = 3): string[] => {
  const collected = collectReadableText(parsed, maxLines);
  if (collected.length > 0) return collected.slice(0, maxLines);
  // Never dump the transport envelope into preview; raw tier owns the full payload.
  if (raw && !isEnvelopeText(raw) && !isJsonLike(raw)) {
    return createDetailLines(raw, maxLines);
  }
  return [];
};

export const enhanceToolPreviewLines = (
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

