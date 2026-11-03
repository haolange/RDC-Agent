import { type ToolContentInput, type UnwrappedToolContent, asFiniteNumber, filterEnvelopeLines, enhanceToolPreviewLines } from './workProcessToolContentShared';
import { stringifyPreview, createDetailLines } from './workProcessContentText';
import { compactText } from './workProcessFormat';

export function unwrapWebContent(input: ToolContentInput): UnwrappedToolContent | null {
  const { toolName, parsed, t, normalized, record, details, argsRecord, contentText } = input;
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
        ? t(resultCount === 1 ? 'chat.previewSourceOne' : 'chat.previewSources', { count: resultCount })
        : t('chat.previewSource');
      const summary = query
        ? t('chat.previewSearchSummary', { sources: countLabel, query: compactText(query, 36) })
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
    if (bytes != null) statusBits.push(t('chat.previewBytes', { count: bytes }));
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
  return null;
}
