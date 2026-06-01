import type { RuntimeLogEntry } from '@shared/types/runtimeLog';

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const formatTimestamp = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

export const formatRaw = (value: RuntimeLogEntry['raw']): string => {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value, null, 2);
};

export const formatShortId = (value?: string | null): string => {
  if (!value) {
    return '-';
  }
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
};

export const stringifyEntryForSearch = (entry: RuntimeLogEntry): string => [
  entry.title,
  entry.summary,
  entry.detail,
  entry.namespace,
  entry.severity,
  entry.sessionId,
  entry.projectId,
  entry.runId,
  formatRaw(entry.raw),
].filter(Boolean).join('\n').toLowerCase();

export const buildEntryCopy = (entry: RuntimeLogEntry): string => [
  `time: ${new Date(entry.timestamp).toISOString()}`,
  `severity: ${entry.severity}`,
  `source: ${entry.namespace}`,
  `title: ${entry.title}`,
  `summary: ${entry.summary}`,
  entry.detail ? `detail: ${entry.detail}` : '',
  `sessionId: ${entry.sessionId ?? ''}`,
  `runId: ${entry.runId ?? ''}`,
  `projectId: ${entry.projectId ?? ''}`,
  entry.raw != null ? `raw:\n${formatRaw(entry.raw)}` : '',
].filter(Boolean).join('\n');
