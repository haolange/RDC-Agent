export interface CompactActionError {
  summary: string;
  detail?: string;
  actionLabel: string;
}

const compactText = (value: string, limit: number): string => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
};

export const compactActionError = (message: string): CompactActionError => {
  const normalized = message.replace(/\s+/g, ' ').trim();
  const code = normalized.match(/^([A-Z][A-Z0-9_]{2,})\b/)?.[1];
  const withoutCode = code ? normalized.slice(code.length).trim() : normalized;
  const firstClause = withoutCode.split(/\s+\u00B7\s+/)[0] ?? withoutCode;
  const summaryBase = code === 'LOCAL_REPLAY_UNSUPPORTED'
    ? firstClause
      .replace(/^capture open failed during open_replay:\s*/i, '')
      .replace(/^OpenCapture failed with status:\s*/i, 'Capture cannot replay locally: ')
    : firstClause;
  return {
    summary: compactText(code ? `${code}: ${summaryBase}` : summaryBase, 168),
    detail: normalized.length > 168 ? normalized : undefined,
    actionLabel: code === 'LOCAL_REPLAY_UNSUPPORTED' ? 'Change device' : 'Retry',
  };
};
