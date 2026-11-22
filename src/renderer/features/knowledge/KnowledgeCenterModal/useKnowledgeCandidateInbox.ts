import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../i18n';
import { useKnowledgeRequestScope } from './useKnowledgeRequestScope';
import { knowledgeErrorMessage } from './knowledgeCenterModel';
import { beginSynchronousFlight } from './knowledgeImportExportModel';
import type { KnowledgeCandidatesResult, KnowledgeCardRecord } from '@shared/types/knowledge';

/**
 * The session's review queue: the candidates waiting for the person, and creating one from a draft card. Candidates
 * belong to a session, so without one there is no queue and nothing can be proposed.
 */
export function useKnowledgeCandidateInbox(options: { open: boolean; sessionId: string | null }) {
  const { t } = useI18n();
  const request = useKnowledgeRequestScope(options.open, options.sessionId ?? '');
  const createRequest = useKnowledgeRequestScope(options.open, options.sessionId ?? '');
  const inFlight = useRef(false);
  const [inbox, setInbox] = useState<KnowledgeCandidatesResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidateError, setCandidateError] = useState<{ cardId: string; message: string } | null>(null);

  const refreshInbox = useCallback(async () => {
    if (!options.sessionId) {
      setInbox(null);
      return;
    }
    const seq = request.next();
    try {
      const next = await window.electronAPI.knowledge.candidates(options.sessionId);
      if (request.isCurrent(seq)) {
        setInbox(next);
        setError(null);
      }
    } catch (err) {
      if (request.isCurrent(seq)) setError(knowledgeErrorMessage(err));
    }
  }, [request, options.sessionId]);

  useEffect(() => {
    setInbox(null);
    setCandidateError(null);
    if (options.open) void refreshInbox();
  }, [options.open, refreshInbox]);

  /** Proposes a draft card for review; `onCreated` runs once the queue shows it. */
  const createCandidate = useCallback(async (card: KnowledgeCardRecord, onCreated?: () => void) => {
    if (!options.sessionId) {
      setCandidateError({ cardId: card.cardId, message: t('knowledgeCenter.sessionRequired') });
      return;
    }
    if (!beginSynchronousFlight(inFlight)) return;
    const seq = createRequest.next();
    setBusy(true);
    setCandidateError(null);
    try {
      await window.electronAPI.knowledge.candidateCreate({ sessionId: options.sessionId, card, explicitUserIntent: true });
      if (!createRequest.isCurrent(seq)) return;
      await refreshInbox();
      if (createRequest.isCurrent(seq)) onCreated?.();
    } catch (err) {
      if (createRequest.isCurrent(seq)) {
        const raw = knowledgeErrorMessage(err);
        setCandidateError({ cardId: card.cardId, message: raw.includes('KNOWLEDGE_ASSETS_MISSING') ? t('knowledgeCenter.candidateAssetsMissing') : raw });
      }
    } finally {
      inFlight.current = false;
      if (createRequest.isCurrent(seq)) setBusy(false);
    }
  }, [createRequest, options.sessionId, refreshInbox, t]);

  return { hasSession: Boolean(options.sessionId), inbox, refreshInbox, busy, error, candidateError, createCandidate };
}
