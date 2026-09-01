import { useCallback, useEffect, useState } from 'react';
import type {
  ColdDataIngestResult,
  KnowledgeCandidatesResult,
  KnowledgeCardRecord,
  KnowledgeSpace,
} from '@shared/types/knowledge';
import { knowledgeErrorMessage } from './knowledgeCenterModel';

export function useKnowledgeImport(options: {
  open: boolean;
  sessionId: string | null;
  spaces: KnowledgeSpace[];
  onCreated: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState('');
  const [filePath, setFilePath] = useState<string | null>(null);
  const [spaceId, setSpaceId] = useState(options.spaces[0]?.spaceId ?? 'user');
  const [result, setResult] = useState<ColdDataIngestResult | null>(null);
  const [inbox, setInbox] = useState<KnowledgeCandidatesResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshInbox = useCallback(async () => {
    if (!options.sessionId) {
      setInbox(null);
      return;
    }
    setInbox(await window.electronAPI.knowledge.candidates(options.sessionId));
  }, [options.sessionId]);

  useEffect(() => {
    if (!options.open) return;
    void refreshInbox();
  }, [options.open, refreshInbox]);

  const close = useCallback(() => {
    setOpen(false);
    setSource('');
    setFilePath(null);
    setResult(null);
    setError(null);
  }, []);

  const openPanel = useCallback(() => {
    setSpaceId(options.spaces[0]?.spaceId ?? 'user');
    setOpen(true);
  }, [options.spaces]);

  const selectFile = useCallback(async () => {
    const paths = await window.electronAPI.selectFiles();
    const next = paths?.[0] ?? null;
    setFilePath(next);
    if (next) setSource('');
  }, []);

  const importSource = useCallback(async () => {
    if (!options.sessionId) {
      setError('KNOWLEDGE_SESSION_REQUIRED');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const imported = await window.electronAPI.knowledge.coldDataImport({
        sessionId: options.sessionId,
        spaceId,
        ...(filePath ? { filePath } : { source }),
      });
      setResult(imported);
      await refreshInbox();
      await options.onCreated();
    } catch (err) {
      setError(knowledgeErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [filePath, options, refreshInbox, source, spaceId]);

  const createCandidate = useCallback(async (card: KnowledgeCardRecord) => {
    if (!options.sessionId) {
      setError('KNOWLEDGE_SESSION_REQUIRED');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await window.electronAPI.knowledge.candidateCreate({
        sessionId: options.sessionId,
        card,
        explicitUserIntent: true,
      });
      await options.onCreated();
      await refreshInbox();
    } catch (err) {
      setError(knowledgeErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [options, refreshInbox]);

  return {
    open,
    openPanel,
    close,
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
