import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../i18n';
import { useKnowledgeRequestScope } from './useKnowledgeRequestScope';
import { knowledgeErrorMessage } from './knowledgeCenterModel';
import { beginSynchronousFlight } from './knowledgeImportExportModel';
import type { KnowledgeImportResult, KnowledgeSpace } from '@shared/types/knowledge';

export type KnowledgeImportMode = 'file' | 'paste';
/** One dialog, three moments: choose a source, see what it would do, see what it did. */
export type KnowledgeImportStep = 'input' | 'preview' | 'result';

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
  const [mode, setMode] = useState<KnowledgeImportMode>('file');
  const [source, setSource] = useState('');
  const [filePath, setFilePath] = useState<string | null>(null);
  const [spaceId, setSpaceId] = useState(options.spaces[0]?.spaceId ?? 'user');
  const [preview, setPreview] = useState<KnowledgeImportResult | null>(null);
  const [result, setResult] = useState<KnowledgeImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    request.next();
    inFlight.current = false;
    setBusy(false);
    setOpen(false);
    setMode('file');
    setSource('');
    setFilePath(null);
    setPreview(null);
    setResult(null);
    setError(null);
  }, [request]);

  useEffect(() => {
    close();
  }, [close, options.open, options.sessionId]);

  const openPanel = useCallback(() => {
    setSpaceId(options.spaces[0]?.spaceId ?? 'user');
    setOpen(true);
  }, [options.spaces]);

  // File and paste are mutually exclusive inputs, so switching clears the other.
  const changeMode = useCallback((next: KnowledgeImportMode) => {
    setMode(next);
    setError(null);
    setPreview(null);
    if (next === 'file') setSource('');
    else setFilePath(null);
  }, []);

  const changeSource = useCallback((next: string) => {
    setSource(next);
    setPreview(null);
  }, []);

  const changeSpace = useCallback((next: string) => {
    setSpaceId(next);
    setPreview(null);
  }, []);

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
      if (request.isCurrent(seq)) setError(knowledgeErrorMessage(err));
    } finally {
      if (request.isCurrent(seq)) setBusy(false);
    }
  }, [request, spaceId]);

  const takeFile = useCallback(async (next: string) => {
    setFilePath(next);
    setSource('');
    await previewSource({ filePath: next });
  }, [previewSource]);

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
        setError(knowledgeErrorMessage(err));
        setBusy(false);
      }
    }
  }, [request, takeFile]);

  /** A dropped file is read from its path on disk, as a chosen one is; a drop without a path cannot be imported. */
  const dropFile = useCallback(async (file: File) => {
    const dropped = window.rdcDesktop?.getPathForFile(file) ?? null;
    if (!dropped) {
      setError(t('knowledgeCenter.importDropUnavailable'));
      return;
    }
    await takeFile(dropped);
  }, [t, takeFile]);

  const previewPasted = useCallback(() => previewSource({ source }), [previewSource, source]);
  const back = useCallback(() => setPreview(null), []);

  const importSource = useCallback(async () => {
    if (!spaceId) {
      setError(t('knowledgeCenter.emptyNoSpaces'));
      return;
    }
    if (!beginSynchronousFlight(inFlight)) return;
    const seq = request.next();
    setBusy(true);
    setError(null);
    try {
      const imported = await window.electronAPI.knowledge.import({
        spaceId,
        ...(options.sessionId ? { sessionId: options.sessionId } : {}),
        ...(filePath ? { filePath } : { source }),
      });
      if (!request.isCurrent(seq) || 'cancelled' in imported) return;
      setPreview(null);
      setResult(imported);
      await options.onImported(imported);
    } catch (err) {
      if (request.isCurrent(seq)) setError(knowledgeErrorMessage(err));
    } finally {
      inFlight.current = false;
      if (request.isCurrent(seq)) setBusy(false);
    }
  }, [filePath, options, request, source, spaceId, t]);

  return {
    open,
    openPanel,
    close,
    step: (result ? 'result' : preview ? 'preview' : 'input') as KnowledgeImportStep,
    mode,
    setMode: changeMode,
    source,
    setSource: changeSource,
    filePath,
    spaceId,
    setSpaceId: changeSpace,
    preview,
    previewPasted,
    back,
    dropFile,
    result,
    busy,
    error,
    selectFile,
    importSource,
  };
}
