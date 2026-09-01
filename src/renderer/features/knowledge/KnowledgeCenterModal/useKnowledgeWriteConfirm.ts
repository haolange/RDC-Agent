import { useCallback, useState } from 'react';
import type { KnowledgeCardRecord, KnowledgePack, KnowledgeQueryRequest } from '@shared/types/knowledge';
import type { AgentPermissionMode } from '@shared/types/settings';
import { useAppSettingsStore } from '../../../stores/appSettingsStore';
import { diffKnowledgeCard, rollbackBasis } from './knowledgeCardDiff';
import { detailToRecord, knowledgeErrorMessage, type KnowledgeWriteAction } from './knowledgeCenterModel';
import {
  canSubmitKnowledgeWrite,
  collectCardContradicts,
  evaluateWriteGate,
  isWriteVersionStale,
  issueKnowledgeWrite,
  resolveWriteConfirmPack,
} from './knowledgeWriteConfirm';

export {
  canSubmitKnowledgeWrite,
  collectCardContradicts,
  evaluateWriteGate,
  isWritePackStale,
  isWriteVersionStale,
  issueKnowledgeWrite,
  resolveWriteConfirmPack,
} from './knowledgeWriteConfirm';

export function useKnowledgeWriteConfirm(options: {
  pack?: KnowledgePack | null;
  packQueryKey?: string | null;
  queryRequest: KnowledgeQueryRequest;
  onWritten: () => Promise<void>;
}) {
  const permissionMode = useAppSettingsStore((state) => state.settings.agentRuntime.permissions.mode) as AgentPermissionMode;
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<KnowledgeWriteAction>('save');
  const [before, setBefore] = useState<KnowledgeCardRecord | null>(null);
  const [after, setAfter] = useState<KnowledgeCardRecord | null>(null);
  const [changeReason, setChangeReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [basis, setBasis] = useState<{ hash: string; bytes: number } | null>(null);
  const [openedUpdatedAt, setOpenedUpdatedAt] = useState<number | undefined>(undefined);
  const [versionStale, setVersionStale] = useState(false);
  const [acknowledgedConflicts, setAcknowledgedConflicts] = useState(false);
  const [gatePack, setGatePack] = useState<KnowledgePack | null>(null);
  const [packReady, setPackReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pack = gatePack ?? options.pack ?? null;
  const contradicts = collectCardContradicts(pack, after);

  const close = useCallback(() => {
    setOpen(false);
    setChangeReason('');
    setConfirmed(false);
    setAcknowledgedConflicts(false);
    setVersionStale(false);
    setGatePack(null);
    setPackReady(false);
    setError(null);
  }, []);

  const openFor = useCallback(async (nextAction: KnowledgeWriteAction, current: KnowledgeCardRecord) => {
    const next = { ...current };
    if (nextAction === 'promote-verified') next.lifecycle = 'verified';
    if (nextAction === 'promote-promoted') next.lifecycle = 'promoted';
    if (nextAction === 'deprecate') next.lifecycle = 'deprecated';
    if (nextAction === 'persist-draft') next.lifecycle = 'draft';
    setAction(nextAction);
    setBefore(current);
    setAfter(next);
    setOpenedUpdatedAt(current.updatedAt);
    setBasis(await rollbackBasis(current.body));
    setChangeReason('');
    setConfirmed(false);
    setAcknowledgedConflicts(false);
    setVersionStale(false);
    setPackReady(false);
    setError(null);
    setOpen(true);
    try {
      const latest = await window.electronAPI.knowledge.card(current.spaceId, current.relativePath);
      if (isWriteVersionStale(latest.card, current.updatedAt)) {
        setVersionStale(true);
      }
      const nextPack = await resolveWriteConfirmPack({
        pack: options.pack,
        packQueryKey: options.packQueryKey,
        queryRequest: options.queryRequest,
        compile: (request) => window.electronAPI.knowledge.compile(request),
      });
      setGatePack(nextPack);
      setPackReady(true);
    } catch (err) {
      setError(knowledgeErrorMessage(err));
    }
  }, [options.pack, options.packQueryKey, options.queryRequest]);

  const submit = useCallback(async () => {
    if (!after) return;
    if (!canSubmitKnowledgeWrite({
      after, changeReason, confirmed, contradicts, acknowledgedConflicts, packReady,
    })) return;
    const block = evaluateWriteGate(action, before ?? after);
    if (block) {
      setError(block);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await issueKnowledgeWrite({
        action,
        after,
        openedUpdatedAt,
        permissionMode,
        api: window.electronAPI.knowledge,
      });
      if (!result.ok) {
        if (result.stale) {
          setVersionStale(true);
          return;
        }
        setError(result.error || 'KNOWLEDGE_APPROVAL_TOKEN_INVALID');
        return;
      }
      await options.onWritten();
      close();
    } catch (err) {
      setError(knowledgeErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [acknowledgedConflicts, action, after, before, changeReason, close, confirmed, contradicts, openedUpdatedAt, options, packReady, permissionMode]);

  return {
    open,
    action,
    before,
    after,
    changeReason,
    setChangeReason,
    confirmed,
    setConfirmed,
    acknowledgedConflicts,
    setAcknowledgedConflicts,
    basis,
    versionStale,
    contradicts,
    packReady,
    busy,
    error,
    block: after ? evaluateWriteGate(action, before ?? after) : null,
    diff: before && after ? diffKnowledgeCard(before, after) : after ? diffKnowledgeCard(null, after) : [],
    openFor,
    close,
    submit,
    toRecord: detailToRecord,
  };
}
