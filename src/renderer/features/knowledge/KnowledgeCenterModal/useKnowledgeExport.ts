import { useCallback, useMemo, useState } from 'react';
import type { KnowledgeLaneHit, KnowledgeSpace } from '@shared/types/knowledge';
import type {
  KnowledgeExportFormat,
  KnowledgeExportResult,
  KnowledgeExportScope,
} from '@shared/types/knowledgeExport';
import { knowledgeErrorMessage } from './knowledgeCenterModel';

const EXTENSION: Record<KnowledgeExportFormat, string> = {
  package: 'yaml',
  markdown: 'md',
};

export function useKnowledgeExport(options: {
  spaces: KnowledgeSpace[];
  hits: KnowledgeLaneHit[];
  selected: { spaceId: string; relativePath: string } | null;
}) {
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
    setOpen(false);
    setError(null);
    setResult(null);
  }, []);

  const openPanel = useCallback(() => {
    setScope(options.selected ? 'selected' : 'filtered');
    setSpaceId(options.spaces[0]?.spaceId ?? 'user');
    setResult(null);
    setError(null);
    setOpen(true);
  }, [options.selected, options.spaces]);

  const run = useCallback(async () => {
    setError(null);
    // Cancelling the save dialog must not produce a partial file or a result row.
    const targetPath = await window.electronAPI.saveFile({
      defaultFileName: `knowledge-export.${EXTENSION[format]}`,
      extension: EXTENSION[format],
    });
    if (!targetPath) return;
    setBusy(true);
    try {
      const cardRefs = scope === 'selected'
        ? (options.selected ? [options.selected] : [])
        : options.hits.map((hit) => ({ spaceId: hit.spaceId, relativePath: hit.relativePath }));
      setResult(await window.electronAPI.knowledge.export({
        format,
        scope,
        targetPath,
        ...(scope === 'space' ? { spaceId } : { cardRefs }),
      }));
    } catch (err) {
      setError(knowledgeErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [format, options.hits, options.selected, scope, spaceId]);

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
