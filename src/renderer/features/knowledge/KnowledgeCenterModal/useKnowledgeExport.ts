import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KnowledgeLaneHit, KnowledgeSpace } from '@shared/types/knowledge';
import type {
  KnowledgeExportFormat,
  KnowledgeExportResult,
  KnowledgeExportScope,
} from '@shared/types/knowledgeExport';
import { useKnowledgeRequestScope } from './useKnowledgeRequestScope';
import { knowledgeErrorMessage } from './knowledgeCenterModel';

const EXTENSION: Record<KnowledgeExportFormat, string> = {
  package: 'yaml',
  markdown: 'md',
};

export function useKnowledgeExport(options: {
  active: boolean;
  spaces: KnowledgeSpace[];
  hits: KnowledgeLaneHit[];
  selected: { spaceId: string; relativePath: string } | null;
}) {
  const request = useKnowledgeRequestScope(options.active);
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<KnowledgeExportScope>('filtered');
  const [format, setFormat] = useState<KnowledgeExportFormat>('package');
  const [spaceId, setSpaceId] = useState(options.spaces[0]?.spaceId ?? 'user');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<KnowledgeExportResult | null>(null);

  /** Counts are derived from live state so the dialog never shows a stale number. */
  const counts = useMemo(() => ({
    selected: options.selected ? 1 : 0,
    filtered: options.hits.length,
    space: options.hits.filter((hit) => hit.spaceId === spaceId).length,
  }), [options.hits, options.selected, spaceId]);

  const canExport = options.hits.length > 0 || Boolean(options.selected);
  const pendingCount = counts[scope];

  const close = useCallback(() => {
    request.next();
    setBusy(false);
    setOpen(false);
    setError(null);
    setResult(null);
  }, [request]);

  useEffect(() => { if (!options.active) close(); }, [close, options.active]);

  const openPanel = useCallback(() => {
    setScope(options.selected ? 'selected' : 'filtered');
    setSpaceId(options.spaces[0]?.spaceId ?? 'user');
    setResult(null);
    setError(null);
    setOpen(true);
  }, [options.selected, options.spaces]);

  const run = useCallback(async () => {
    const seq = request.next();
    setError(null);
    setBusy(true);
    try {
      // The native picker can fail or be cancelled before export starts.
      const targetPath = await window.electronAPI.saveFile({
        defaultFileName: `knowledge-export.${EXTENSION[format]}`,
        extension: EXTENSION[format],
      });
      if (!targetPath || !request.isCurrent(seq)) return;
      const cardRefs = scope === 'selected'
        ? (options.selected ? [options.selected] : [])
        : options.hits.map((hit) => ({ spaceId: hit.spaceId, relativePath: hit.relativePath }));
      const exported = await window.electronAPI.knowledge.export({
        format,
        scope,
        targetPath,
        ...(scope === 'space' ? { spaceId } : { cardRefs }),
      });
      if (request.isCurrent(seq)) setResult(exported);
    } catch (err) {
      if (request.isCurrent(seq)) setError(knowledgeErrorMessage(err));
    } finally {
      if (request.isCurrent(seq)) setBusy(false);
    }
  }, [format, options.hits, options.selected, request, scope, spaceId]);

  return {
    open,
    openPanel,
    close,
    scope,
    setScope,
    format,
    setFormat,
    spaceId,
    setSpaceId,
    counts,
    pendingCount,
    canExport,
    busy,
    error,
    result,
    run,
  };
}
