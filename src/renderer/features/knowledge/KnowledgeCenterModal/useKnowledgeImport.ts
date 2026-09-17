import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  KnowledgeImportResult,
  KnowledgeCandidatesResult,
  KnowledgeCardRecord,
  KnowledgeSpace,
} from '@shared/types/knowledge';
import { useKnowledgeRequestScope } from './useKnowledgeRequestScope';
import { knowledgeErrorMessage } from './knowledgeCenterModel';
import { beginSynchronousFlight } from './knowledgeImportExportModel';
import { useI18n } from '../../../i18n';

export type KnowledgeImportMode = 'file' | 'paste';

export function useKnowledgeImport(options: {
  open: boolean;
  sessionId: string | null;
  spaces: KnowledgeSpace[];
  onImported: (result: KnowledgeImportResult) => Promise<void>;
}) {
  const { t } = useI18n();
  const request = useKnowledgeRequestScope(options.open, options.sessionId ?? '');
  const inboxRequest = useKnowledgeRequestScope(options.open, options.sessionId ?? '');
  const inFlight = useRef(false);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<KnowledgeImportMode>('file');
  const [source, setSource] = useState('');
  const [filePath, setFilePath] = useState<string | null>(null);
  const [spaceId, setSpaceId] = useState(options.spaces[0]?.spaceId ?? 'user');
  const [result, setResult] = useState<KnowledgeImportResult | null>(null);
  const [inbox, setInbox] = useState<KnowledgeCandidatesResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshInbox = useCallback(async () => {
    if (!options.sessionId) {
      setInbox(null);
      return;
    }
    const seq = inboxRequest.next();
    try {
      const next = await window.electronAPI.knowledge.candidates(options.sessionId);
      if (inboxRequest.isCurrent(seq)) setInbox(next);
    } catch (err) {
      if (inboxRequest.isCurrent(seq)) setError(knowledgeErrorMessage(err));
    }
  }, [inboxRequest, options.sessionId]);

  useEffect(() => {
    if (!options.open) return;
    void refreshInbox();
  }, [options.open, refreshInbox]);

  const close = useCallback(() => {
    request.next();
    inFlight.current = false;
    setBusy(false);
    setOpen(false);
    setMode('file');
    setSource('');
    setFilePath(null);
    setResult(null);
    setError(null);
  }, [request]);

  useEffect(() => {
    close();
    setInbox(null);
  }, [close, options.open, options.sessionId]);

  const openPanel = useCallback(() => {
    setSpaceId(options.spaces[0]?.spaceId ?? 'user');
    setOpen(true);
  }, [options.spaces]);

  // File and paste are mutually exclusive inputs, so switching clears the other.
  const changeMode = useCallback((next: KnowledgeImportMode) => {
    setMode(next);
    setError(null);
    if (next === 'file') setSource('');
    else setFilePath(null);
  }, []);

  const selectFile = useCallback(async () => {
    if (inFlight.current) return;
    const seq = request.next();
    setBusy(true);
    setError(null);
    try {
      const next = await window.electronAPI.selectKnowledgeImport();
      if (!request.isCurrent(seq)) return;
      setFilePath(next);
      if (next) setSource('');
    } catch (err) {
      if (request.isCurrent(seq)) setError(knowledgeErrorMessage(err));
    } finally {
      if (request.isCurrent(seq)) setBusy(false);
    }
  }, [request]);

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
      if (!request.isCurrent(seq)) return;
      setResult(imported);
      await refreshInbox();
      if (!request.isCurrent(seq)) return;
      await options.onImported(imported);
    } catch (err) {
      if (request.isCurrent(seq)) setError(knowledgeErrorMessage(err));
    } finally {
      inFlight.current = false;
      if (request.isCurrent(seq)) setBusy(false);
    }
  }, [filePath, options, refreshInbox, request, source, spaceId, t]);

  const createCandidate = useCallback(async (card: KnowledgeCardRecord) => {
    if (!options.sessionId) {
      setError(t('knowledgeCenter.sessionRequired'));
      return;
    }
    if (!beginSynchronousFlight(inFlight)) return;
    const seq = request.next();
    setBusy(true);
    setError(null);
    try {
      await window.electronAPI.knowledge.candidateCreate({
        sessionId: options.sessionId,
        card,
        explicitUserIntent: true,
      });
      if (!request.isCurrent(seq)) return;
      await refreshInbox();
      if (request.isCurrent(seq)) close();
    } catch (err) {
      if (request.isCurrent(seq)) setError(knowledgeErrorMessage(err));
    } finally {
      inFlight.current = false;
      if (request.isCurrent(seq)) setBusy(false);
    }
  }, [close, options.sessionId, refreshInbox, request, t]);

  return {
    hasSession: Boolean(options.sessionId),
    open,
    openPanel,
    close,
    mode,
    setMode: changeMode,
    source,
    setSource,
    filePath,
    spaceId,
    setSpaceId,
    result,
    inbox,
    refreshInbox,
    busy,
    error,
    selectFile,
    importSource,
    createCandidate,
  };
}
