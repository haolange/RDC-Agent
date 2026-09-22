import { toRecord, readNestedValue, stringifyPreview } from './workProcessContentText';
import { normalizeToolName } from './workProcessToolCatalog';

export const getDetailsRecord = (record: Record<string, unknown> | null | undefined): Record<string, unknown> | null => {
  if (!record) return null;
  return toRecord(record.details)
    ?? toRecord(readNestedValue(record, ['data', 'details']))
    ?? toRecord(readNestedValue(record, ['result', 'details']));
};

const resolveUrlHostname = (url: string): string => {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
};

const resolveSourceDomain = (result: Record<string, unknown>): string => {
  const url = stringifyPreview(result.url);
  const source = stringifyPreview(result.source ?? result.domain);
  if (source) return source.replace(/^https?:\/\//i, '').split('/')[0] || source;
  if (url) return resolveUrlHostname(url);
  return '';
};

export const extractWebToolPresentation = (
  toolName: string,
  parsedResult: unknown,
): {
  sourcePills?: Array<{ domain: string; url?: string; title?: string }>;
  pageChip?: {
    domain: string;
    url: string;
    pathLabel?: string;
    title?: string;
    status?: number;
    bytes?: number;
  };
} => {
  const normalized = normalizeToolName(toolName);
  const record = toRecord(parsedResult);
  const details = getDetailsRecord(record);

  if (normalized === 'web_search' || details?.kind === 'search') {
    const resultRecords = getRecordArray(
      details?.results
      ?? record?.results
      ?? readNestedValue(record ?? {}, ['data', 'details', 'results']),
    );
    const sourcePills = resultRecords
      .slice(0, 6)
      .map((result) => {
        const domain = resolveSourceDomain(result);
        if (!domain) return null;
        const url = stringifyPreview(result.url) || undefined;
        const title = stringifyPreview(result.title) || undefined;
        return { domain, url, title } as { domain: string; url?: string; title?: string };
      })
      .filter((entry): entry is { domain: string; url?: string; title?: string } => entry != null);
    return sourcePills.length > 0 ? { sourcePills } : {};
  }

  if (normalized === 'web_fetch' || details?.kind === 'fetch') {
    const url = stringifyPreview(
      details?.url
      ?? record?.url
      ?? readNestedValue(record ?? {}, ['data', 'details', 'url']),
    );
    if (!url) return {};
    const domain = resolveUrlHostname(url);
    if (!domain) return {};
    let pathLabel: string | undefined;
    try {
      const parsed = new URL(url);
      const combined = `${parsed.pathname || '/'}${parsed.search || ''}`;
      if (combined && combined !== '/') {
        pathLabel = combined.length > 48 ? `${combined.slice(0, 47)}…` : combined;
      }
    } catch {
      pathLabel = undefined;
    }
    const statusRaw = details?.status ?? record?.status ?? readNestedValue(record ?? {}, ['data', 'details', 'status']);
    const bytesRaw = details?.bytes ?? record?.bytes ?? readNestedValue(record ?? {}, ['data', 'details', 'bytes']);
    const title = stringifyPreview(
      details?.title
      ?? record?.title
      ?? readNestedValue(record ?? {}, ['data', 'details', 'title']),
    ) || undefined;
    const status = typeof statusRaw === 'number' && Number.isFinite(statusRaw) ? statusRaw : undefined;
    const bytes = typeof bytesRaw === 'number' && Number.isFinite(bytesRaw) ? bytesRaw : undefined;
    return {
      pageChip: {
        domain,
        url,
        ...(pathLabel ? { pathLabel } : {}),
        ...(title ? { title } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(bytes !== undefined ? { bytes } : {}),
      },
    };
  }

  return {};
};

export const getRecordArray = (value: unknown): Array<Record<string, unknown>> => {
  if (!Array.isArray(value)) return [];
  return value.map(toRecord).filter((entry): entry is Record<string, unknown> => Boolean(entry));
};
