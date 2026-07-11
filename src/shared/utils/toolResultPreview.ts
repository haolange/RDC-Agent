/**
 * Build a projection-friendly `resultPreview` for conversation work-trace tool cards.
 *
 * Avoids blind `JSON.stringify(result).slice(0, N)` which truncates mid-JSON and
 * can drop `details.matched` / path lists that the Work Process UI needs.
 *
 * Preserves: ok, truncated content text, structured details (counts + compact web results).
 * Omits: bulky artifacts arrays; keeps duration_ms / trace_id when present.
 */

const CONTENT_TEXT_MAX_CHARS = 4000;
const CONTENT_TEXT_MAX_LINES = 30;
const WEB_RESULTS_MAX = 8;
const PREVIEW_JSON_MAX_CHARS = 12_000;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const truncateText = (text: string, maxChars = CONTENT_TEXT_MAX_CHARS, maxLines = CONTENT_TEXT_MAX_LINES): string => {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const clippedLines = lines.length > maxLines
    ? [...lines.slice(0, maxLines), `… (${lines.length - maxLines} more lines)`]
    : lines;
  let clipped = clippedLines.join('\n');
  if (clipped.length > maxChars) {
    clipped = `${clipped.slice(0, maxChars)}…`;
  }
  return clipped;
};

const extractContentText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const item of content) {
    if (typeof item === 'string') {
      parts.push(item);
      continue;
    }
    if (!isRecord(item)) continue;
    if (typeof item.text === 'string') parts.push(item.text);
    else if (typeof item.content === 'string') parts.push(item.content);
  }
  return parts.join('\n');
};

const resolveContentText = (data: Record<string, unknown>): string => {
  const fromContent = extractContentText(data.content);
  if (fromContent) return fromContent;
  if (Array.isArray(data.matches)) return data.matches.map(String).join('\n');
  if (typeof data.stdout === 'string') return data.stdout;
  if (typeof data.text === 'string') return data.text;
  return '';
};

const compactWebResults = (results: unknown): unknown[] | undefined => {
  if (!Array.isArray(results)) return undefined;
  return results.slice(0, WEB_RESULTS_MAX).map((entry) => {
    if (!isRecord(entry)) return entry;
    return {
      title: typeof entry.title === 'string' ? entry.title : undefined,
      url: typeof entry.url === 'string' ? entry.url : undefined,
      snippet: typeof entry.snippet === 'string'
        ? truncateText(entry.snippet, 240, 3)
        : undefined,
    };
  });
};

const compactDetails = (
  details: unknown,
  extras?: Record<string, unknown>,
): Record<string, unknown> | null => {
  const base = isRecord(details) ? { ...details } : {};
  if (extras) {
    for (const [key, value] of Object.entries(extras)) {
      if (value !== undefined && base[key] === undefined) base[key] = value;
    }
  }
  if (Object.keys(base).length === 0) return details == null ? null : { value: details };

  if (Array.isArray(base.results)) {
    const originalLength = base.results.length;
    base.results = compactWebResults(base.results);
    if (base.resultCount == null) base.resultCount = originalLength;
  }
  for (const key of Object.keys(base)) {
    const value = base[key];
    if (
      typeof value === 'string'
      && value.length > 800
      && !['pattern', 'query', 'command', 'path', 'cwd', 'url'].includes(key)
    ) {
      base[key] = truncateText(value, 800, 12);
    }
  }
  return base;
};

const compactData = (data: Record<string, unknown>): Record<string, unknown> => {
  const text = resolveContentText(data);
  const truncated = text ? truncateText(text) : '';
  const content = truncated ? [{ type: 'text', text: truncated }] : [];
  const detailExtras: Record<string, unknown> = {};
  if (Array.isArray(data.matches) && detailExtras.matched === undefined) {
    detailExtras.matched = data.matches.length;
  }
  if (data.lineCount != null) detailExtras.lineCount = data.lineCount;
  if (data.totalLines != null) detailExtras.totalLines = data.totalLines;

  return {
    content,
    details: compactDetails(data.details, detailExtras),
  };
};

/**
 * Serialize a tool completion payload into a stable, UI-projectable preview string.
 */
export const buildToolResultPreview = (result: unknown): string => {
  if (result == null) return '{}';

  if (typeof result !== 'object') {
    const text = truncateText(String(result));
    return JSON.stringify({ ok: true, data: { content: [{ type: 'text', text }], details: null } });
  }

  const record = result as Record<string, unknown>;

  // Denied / non-envelope shapes: keep reason visible.
  if (!('ok' in record) && !('data' in record) && typeof record.reason === 'string') {
    return JSON.stringify({
      ok: false,
      error: { message: record.reason, code: 'DENIED', category: 'policy' },
    });
  }

  const dataSource = isRecord(record.data)
    ? record.data
    : {
      content: record.content,
      details: record.details,
      matches: record.matches,
      stdout: record.stdout,
      text: record.text,
      lineCount: record.lineCount,
      totalLines: record.totalLines,
    };

  const preview: Record<string, unknown> = {
    ok: record.ok !== false,
    data: compactData(dataSource),
  };
  if (record.ok === false && record.error != null) preview.error = record.error;
  if (record.duration_ms != null) preview.duration_ms = record.duration_ms;
  if (record.trace_id != null) preview.trace_id = record.trace_id;

  const encoded = JSON.stringify(preview);
  return encoded.length > PREVIEW_JSON_MAX_CHARS
    ? encoded.slice(0, PREVIEW_JSON_MAX_CHARS)
    : encoded;
};
