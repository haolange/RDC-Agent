import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../i18n';
import { humanizeError } from '../../../i18n/humanizeError';
import { errorDetail } from '../../../lib/errorDetail';
import { useKnowledgeOperation } from './useKnowledgeOperation';
import { useKnowledgeRequestScope } from './useKnowledgeRequestScope';
import { beginSynchronousFlight } from './knowledgeImportExportModel';
import { useKnowledgeImportSource } from './useKnowledgeImportSource';
import type { KnowledgeImportResult, KnowledgeSpace } from '@shared/types/knowledge';

/** One dialog, three moments: choose a source, see what it would do, see what it did. */
export type KnowledgeImportStep = 'input' | 'preview' | 'result';
/** Why importing stopped: one sentence to show, and the technical reason that only "Copy details" carries. */
export type KnowledgeImportError = { message: string; detail?: string };

export function useKnowledgeImport(options: {
  open: boolean;
  sessionId: string | null;
  spaces: KnowledgeSpace[];
  onImported: (result: KnowledgeImportResult) => Promise<void>;
}) {
  const { t } = useI18n();
  const request = useKnowledgeRequestScope(options.open, options.sessionId ?? '');
  const inFlight = useRef(false);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<KnowledgeImportResult | null>(null);
  const [result, setResult] = useState<KnowledgeImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<KnowledgeImportError | null>(null);
  // The person stopped the last import; main removed what it had written, so this is said plainly, not as an error.
  const [cancelled, setCancelled] = useState(false);
  const { run: runOperation, cancel: cancelImport, ...operation } = useKnowledgeOperation();
  const input = useKnowledgeImportSource(options.spaces[0]?.spaceId ?? 'user', setPreview, setError);
  const { source, filePath, spaceId, setSpaceId, chooseFile, resetSource } = input;
  const fail = useCallback((err: unknown) => setError({ message: humanizeError(err, t, 'app.error.actionFailed'), detail: errorDetail(err) }), [t]);

  const close = useCallback(() => {
    request.next();
    inFlight.current = false;
    setBusy(false);
    setOpen(false);
    resetSource();
    setPreview(null);
    setResult(null);
    setError(null);
    setCancelled(false);
  }, [request, resetSource]);

  useEffect(close, [close, options.open, options.sessionId]);

  const openPanel = useCallback(() => {
    setSpaceId(options.spaces[0]?.spaceId ?? 'user');
    setOpen(true);
  }, [options.spaces, setSpaceId]);

  /** Reads the source and reports, item by item, what importing it into the chosen space would do. Writes nothing. */
  const previewSource = useCallback(async (input: { filePath: string } | { source: string }) => {
    if (inFlight.current) return;
    const seq = request.next();
    setBusy(true);
    setError(null);
    try {
      const planned = await window.electronAPI.knowledge.previewImport({ spaceId, ...input });
      if (request.isCurrent(seq)) setPreview(planned);
    } catch (err) {
      if (request.isCurrent(seq)) fail(err);
    } finally {
      if (request.isCurrent(seq)) setBusy(false);
    }
  }, [fail, request, spaceId]);

  const takeFile = useCallback(async (next: string) => {
    chooseFile(next);
    await previewSource({ filePath: next });
  }, [chooseFile, previewSource]);

  const selectFile = useCallback(async () => {
    if (inFlight.current) return;
    const seq = request.next();
    setBusy(true);
    setError(null);
    try {
      const next = await window.electronAPI.selectKnowledgeImport();
      if (!request.isCurrent(seq)) return;
      setBusy(false);
      if (next) await takeFile(next);
    } catch (err) {
      if (request.isCurrent(seq)) {
        fail(err);
        setBusy(false);
      }
    }
  }, [fail, request, takeFile]);

  /** A dropped file is read from its path on disk, as a chosen one is; a drop without a path cannot be imported. */
  const dropFile = useCallback(async (file: File) => {
    const dropped = window.rdcDesktop?.getPathForFile(file) ?? null;
    if (!dropped) {
      setError({ message: t('knowledgeCenter.importDropUnavailable') });
      return;
    }
    await takeFile(dropped);
  }, [t, takeFile]);

  const previewPasted = useCallback(() => previewSource({ source }), [previewSource, source]);
  const back = useCallback(() => {
    setPreview(null);
    setCancelled(false);
  }, []);

  const importSource = useCallback(async () => {
    if (!spaceId) {
      setError({ message: t('knowledgeCenter.emptyNoSpaces') });
      return;
    }
    if (!beginSynchronousFlight(inFlight)) return;
    const seq = request.next();
    setBusy(true);
    setError(null);
    setCancelled(false);
    try {
      const outcome = await runOperation((operationId) => window.electronAPI.knowledge.import({
        operationId,
        spaceId,
        ...(options.sessionId ? { sessionId: options.sessionId } : {}),
        ...(filePath ? { filePath } : { source }),
      }));
      if (!request.isCurrent(seq)) return;
      if (outcome.cancelled) {
        setCancelled(true);
        return;
      }
      const imported = outcome.value;
      if ('cancelled' in imported) return;
      setPreview(null);
      setResult(imported);
      await options.onImported(imported);
    } catch (err) {
      if (request.isCurrent(seq)) fail(err);
    } finally {
      inFlight.current = false;
      if (request.isCurrent(seq)) setBusy(false);
    }
  }, [fail, filePath, options, request, runOperation, source, spaceId, t]);

  return {
    ...input.view,
    open,
    openPanel,
    close,
    step: (result ? 'result' : preview ? 'preview' : 'input') as KnowledgeImportStep,
    preview,
    previewPasted,
    back,
    dropFile,
    result,
    busy,
    error,
    cancelled,
    /** The import that is writing right now: its progress, and Cancel while main has not answered it yet. */
    operation,
    cancelImport,
    selectFile,
    importSource,
  };
}
