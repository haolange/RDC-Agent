import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { errorDetail } from '../../../lib/errorDetail';
import { useKnowledgeOperation } from './useKnowledgeOperation';
import { useKnowledgeRequestScope } from './useKnowledgeRequestScope';
import {
  beginSynchronousFlight,
  filterPickableCards,
  knowledgeCardKey,
  knowledgeExportScopeCounts,
} from './knowledgeImportExportModel';
import type { KnowledgeExportFormat, KnowledgeExportResult, KnowledgeExportScope } from '@shared/types/knowledgeExport';
import type { KnowledgeLaneHit, KnowledgeQueryRequest, KnowledgeSpace } from '@shared/types/knowledge';

export function useKnowledgeExport(options: {
  active: boolean;
  spaces: KnowledgeSpace[];
  hits: KnowledgeLaneHit[];
  queryRequest: KnowledgeQueryRequest;
  queryRevision?: string;
  filteredCount?: number;
  selected: { spaceId: string; relativePath: string } | null;
}) {
  const request = useKnowledgeRequestScope(options.active);
  const inFlight = useRef(false);
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<KnowledgeExportScope>('filtered');
  const [format, setFormat] = useState<KnowledgeExportFormat>('package');
  const [spaceId, setSpaceId] = useState(options.spaces[0]?.spaceId ?? 'user');
  const [spaceCount, setSpaceCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<KnowledgeExportResult | null>(null);
  // The person stopped the last export; main wrote no file, so the panel says so instead of showing an error.
  const [cancelled, setCancelled] = useState(false);
  const { run: runOperation, cancel: cancelExport, ...operation } = useKnowledgeOperation();
  // The picker chooses among the cards the list has loaded; the selected card starts picked.
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [pickerQuery, setPickerQuery] = useState('');
  const pickable = useMemo(() => filterPickableCards(options.hits, pickerQuery), [options.hits, pickerQuery]);

  useEffect(() => {
    if (!open) return;
    const seq = request.next();
    void window.electronAPI.knowledge
      .query({ spaceIds: [spaceId] })
      .then((listed) => {
        if (request.isCurrent(seq)) setSpaceCount(listed.hits.length);
      })
      .catch((err) => {
        if (request.isCurrent(seq)) setError(errorDetail(err));
      });
  }, [open, request, spaceId]);

  /** Space count comes from listCards/query of that spaceId, not the filtered Cards hits. */
  const counts = useMemo(
    () =>
      knowledgeExportScopeCounts({
        picked: picked.size,
        hits: options.hits,
        filteredCount: options.filteredCount,
        spaceCount,
      }),
    [options.filteredCount, options.hits, picked, spaceCount],
  );

  const canExport = options.hits.length > 0 || Boolean(options.selected) || options.spaces.length > 0;
  const pendingCount = counts[scope];

  const close = useCallback(() => {
    request.next();
    inFlight.current = false;
    setBusy(false);
    setOpen(false);
    setError(null);
    setResult(null);
    setCancelled(false);
  }, [request]);

  useEffect(() => {
    if (!options.active) close();
  }, [close, options.active]);

  const togglePicked = useCallback((card: { spaceId: string; relativePath: string }) => {
    setPicked((current) => {
      const next = new Set(current);
      const key = knowledgeCardKey(card);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const pickAll = useCallback(
    () => setPicked((current) => new Set([...current, ...pickable.map(knowledgeCardKey)])),
    [pickable],
  );
  const clearPicked = useCallback(() => setPicked(new Set()), []);

  const openPanel = useCallback(() => {
    setPicked(new Set(options.selected ? [knowledgeCardKey(options.selected)] : []));
    setPickerQuery('');
    setScope(options.selected ? 'selected' : 'filtered');
    setSpaceId(options.spaces[0]?.spaceId ?? 'user');
    setResult(null);
    setError(null);
    setCancelled(false);
    setOpen(true);
  }, [options.selected, options.spaces]);

  const run = useCallback(async () => {
    if (!beginSynchronousFlight(inFlight)) return;
    const seq = request.next();
    setError(null);
    setCancelled(false);
    setBusy(true);
    try {
      const filtered =
        scope === 'filtered'
          ? await window.electronAPI.knowledge.query({
              ...options.queryRequest,
              ...(options.queryRevision ? { expectedRevision: options.queryRevision } : {}),
            })
          : null;
      if (!request.isCurrent(seq)) return;
      const cardRefs =
        scope === 'selected'
          ? options.hits
              .filter((hit) => picked.has(knowledgeCardKey(hit)))
              .map((hit) => ({ spaceId: hit.spaceId, relativePath: hit.relativePath }))
          : (filtered?.hits ?? []).map((hit) => ({ spaceId: hit.spaceId, relativePath: hit.relativePath }));
      const outcome = await runOperation((operationId) =>
        window.electronAPI.knowledge.export({
          operationId,
          format,
          scope,
          ...(scope === 'space' ? { spaceId } : { cardRefs }),
        }),
      );
      if (!request.isCurrent(seq)) return;
      if (outcome.cancelled) setCancelled(true);
      // `null`: the person dismissed main's save dialog; the panel stays as it was.
      else if (outcome.value) setResult(outcome.value);
    } catch (err) {
      if (request.isCurrent(seq)) setError(errorDetail(err));
    } finally {
      inFlight.current = false;
      if (request.isCurrent(seq)) setBusy(false);
    }
  }, [
    format,
    options.hits,
    options.queryRequest,
    options.queryRevision,
    picked,
    request,
    runOperation,
    scope,
    spaceId,
  ]);

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
    picked,
    pickable,
    pickerQuery,
    setPickerQuery,
    togglePicked,
    pickAll,
    clearPicked,
    canExport,
    busy,
    error,
    cancelled,
    /** The export that is running right now: its progress, and Cancel while main has not answered it yet. */
    operation,
    cancelExport,
    result,
    run,
  };
}
