import { webHostname } from '@shared/utils/webUrl';
import { toRecord, readNestedValue, stringifyPreview, parsePreview } from './workProcessContentText';
import { normalizeToolName } from './workProcessToolCatalog';
import type { WorkProcessRowStatus, WorkProcessWebPage } from './workProcessTypes';

export const getDetailsRecord = (
  record: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null => {
  if (!record) return null;
  return (
    toRecord(record.details) ??
    toRecord(readNestedValue(record, ['data', 'details'])) ??
    toRecord(readNestedValue(record, ['result', 'details']))
  );
};

const getRecordArray = (value: unknown): Array<Record<string, unknown>> => {
  if (!Array.isArray(value)) return [];
  return value.map(toRecord).filter((entry): entry is Record<string, unknown> => Boolean(entry));
};

const pageState = (status: WorkProcessRowStatus): WorkProcessWebPage['state'] =>
  status === 'error' || status === 'cancelled'
    ? 'failed'
    : status === 'complete' || status === 'skipped'
      ? 'done'
      : 'pending';

export interface WebToolPresentation {
  /** Search results, or the one page a read targets, in order; each renders as a pill. */
  webPages?: WorkProcessWebPage[];
  /** The query a search ran. */
  webQuery?: string;
  /** Technical facts of a read, shown only in the expanded detail. */
  webMeta?: { path?: string; status?: number; bytes?: number };
}

/**
 * Pages and query for web_fetch and web_search, from the tool's details or, after the result was offloaded to a session
 * file, from the display gist the offload kept. A running call already shows the page or query from its arguments.
 */
export const extractWebToolPresentation = (
  toolName: string,
  parsedResult: unknown,
  argsPreview: string | undefined,
  status: WorkProcessRowStatus,
): WebToolPresentation => {
  const normalized = normalizeToolName(toolName);
  if (normalized !== 'web_fetch' && normalized !== 'web_search') return {};
  const details = getDetailsRecord(toRecord(parsedResult));
  const display = toRecord(details?.display);
  const args = toRecord(parsePreview(argsPreview));
  const state = pageState(status);

  if (normalized === 'web_search') {
    const source = display ?? details;
    const webQuery = stringifyPreview(source?.query ?? args?.query) || undefined;
    const results = getRecordArray(source?.results);
    const webPages = results.flatMap((result) => {
      const url = stringifyPreview(result.url);
      if (!url) return [];
      const title = stringifyPreview(result.title) || undefined;
      const snippet = stringifyPreview(result.snippet) || undefined;
      return [{ url, domain: webHostname(url), title, snippet, state: 'done' as const }];
    });
    return { ...(webQuery ? { webQuery } : {}), ...(webPages.length ? { webPages } : {}) };
  }

  const source = display ?? details;
  const url = stringifyPreview(source?.url ?? args?.url);
  if (!url) return {};
  const title = stringifyPreview(source?.title) || undefined;
  const statusCode = typeof source?.status === 'number' && Number.isFinite(source.status) ? source.status : undefined;
  const bytes = typeof details?.bytes === 'number' && Number.isFinite(details.bytes) ? details.bytes : undefined;
  let path: string | undefined;
  try {
    const parsed = new URL(url);
    const combined = `${parsed.pathname || '/'}${parsed.search || ''}`;
    path = combined !== '/' ? combined : undefined;
  } catch {
    path = undefined;
  }
  const failed = state === 'failed' || (statusCode !== undefined && statusCode >= 400);
  return {
    webPages: [{ url, domain: webHostname(url), title, state: failed ? 'failed' : state }],
    webMeta: {
      ...(path ? { path } : {}),
      ...(statusCode !== undefined ? { status: statusCode } : {}),
      ...(bytes !== undefined ? { bytes } : {}),
    },
  };
};
