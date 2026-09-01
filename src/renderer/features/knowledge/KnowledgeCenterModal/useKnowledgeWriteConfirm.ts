import { useCallback, useState } from 'react';
import {
  KNOWLEDGE_CASE_CHAPTERS,
  type KnowledgeCardRecord,
  type KnowledgePack,
  type KnowledgePackConflict,
  type KnowledgeQueryRequest,
} from '@shared/types/knowledge';
import type { AgentPermissionMode } from '@shared/types/settings';
import { useAppSettingsStore } from '../../../stores/appSettingsStore';
import { diffKnowledgeCard, rollbackBasis } from './knowledgeCardDiff';
import {
  detailToRecord,
  knowledgeErrorMessage,
  knowledgeQueryKey,
  type KnowledgeWriteAction,
} from './knowledgeCenterModel';

function missingChapters(chapters: KnowledgeCardRecord['chapters']): string[] {
  return KNOWLEDGE_CASE_CHAPTERS.filter((chapter) => !chapters?.[chapter]?.trim());
}

export function evaluateWriteGate(action: KnowledgeWriteAction, card: KnowledgeCardRecord): string | null {
  if (action === 'promote-verified' && card.lifecycle === 'draft') {
    return 'draft-to-verified';
  }
  if (action === 'promote-verified' && card.type === 'case') {
    const missing = missingChapters(card.chapters);
    if (missing.length > 0) return `missing-chapters:${missing.join(',')}`;
  }
  return null;
}

export function isWriteVersionStale(
  latest: { updatedAt?: number } | null | undefined,
  openedUpdatedAt: number | undefined,
): boolean {
  if (!latest) return false;
  return openedUpdatedAt == null || latest.updatedAt !== openedUpdatedAt;
}

export function collectCardContradicts(
  pack: KnowledgePack | null | undefined,
  card: KnowledgeCardRecord | null,
): KnowledgePackConflict[] {
  if (!card) return [];
  const seen = new Set<string>();
  const conflicts: KnowledgePackConflict[] = [];
  const push = (leftCardId: string, rightCardId: string) => {
    const key = leftCardId < rightCardId ? `${leftCardId}|${rightCardId}` : `${rightCardId}|${leftCardId}`;
    if (seen.has(key)) return;
    seen.add(key);
    conflicts.push({ leftCardId, rightCardId, kind: 'contradicts' });
  };
  for (const entry of pack?.conflicts ?? []) {
    if (entry.kind !== 'contradicts') continue;
    if (entry.leftCardId === card.cardId || entry.rightCardId === card.cardId) {
      push(entry.leftCardId, entry.rightCardId);
    }
  }
  for (const relation of card.relations) {
    if (relation.kind === 'contradicts') push(card.cardId, relation.targetCardId);
  }
  return conflicts;
}

export function isWritePackStale(
  pack: KnowledgePack | null | undefined,
  packQueryKey: string | null | undefined,
  queryRequest: KnowledgeQueryRequest,
): boolean {
  if (!pack) return true;
  return packQueryKey !== knowledgeQueryKey(queryRequest);
}

export async function resolveWriteConfirmPack(input: {
  pack: KnowledgePack | null | undefined;
  packQueryKey: string | null | undefined;
  queryRequest: KnowledgeQueryRequest;
  compile: (request: KnowledgeQueryRequest & { limit?: number }) => Promise<KnowledgePack>;
}): Promise<KnowledgePack> {
  if (!isWritePackStale(input.pack, input.packQueryKey, input.queryRequest) && input.pack) {
    return input.pack;
  }
  return input.compile({ ...input.queryRequest, limit: 50 });
}

export function canSubmitKnowledgeWrite(input: {
  after: KnowledgeCardRecord | null;
  changeReason: string;
  confirmed: boolean;
  contradicts: KnowledgePackConflict[];
  acknowledgedConflicts: boolean;
  packReady?: boolean;
}): boolean {
  if (input.packReady === false) return false;
  if (!input.after || !input.changeReason.trim() || !input.confirmed) return false;
  if (input.contradicts.length > 0 && !input.acknowledgedConflicts) return false;
  return true;
}

export async function issueKnowledgeWrite(input: {
  action: KnowledgeWriteAction;
  after: KnowledgeCardRecord;
  openedUpdatedAt: number | undefined;
  permissionMode: AgentPermissionMode;
  api: {
    card: (spaceId: string, relativePath: string) => Promise<{ card: { updatedAt?: number } | null }>;
    issueApprovalToken: (request: {
      action: 'knowledge.write' | 'knowledge.promote';
      spaceId: string;
      relativePath: string;
    }) => Promise<{ token?: string; error?: string }>;
    write: (request: {
      spaceId: string;
      card: KnowledgeCardRecord;
      permissionMode: AgentPermissionMode;
      confirmation: { explicitHumanConfirmation: true };
      approvalToken: string;
    }) => Promise<unknown>;
    promote: (request: {
      spaceId: string;
      card: KnowledgeCardRecord;
      permissionMode: AgentPermissionMode;
      confirmation: { explicitHumanConfirmation: true };
      approvalToken: string;
      to: 'verified' | 'promoted' | 'deprecated';
    }) => Promise<unknown>;
  };
}): Promise<{ ok: true } | { ok: false; stale?: true; error?: string }> {
  const latest = await input.api.card(input.after.spaceId, input.after.relativePath);
  if (isWriteVersionStale(latest.card, input.openedUpdatedAt)) {
    return { ok: false, stale: true };
  }
  const isPromote = input.action === 'promote-verified' || input.action === 'promote-promoted' || input.action === 'deprecate';
  const issued = await input.api.issueApprovalToken({
    action: isPromote ? 'knowledge.promote' : 'knowledge.write',
    spaceId: input.after.spaceId,
    relativePath: input.after.relativePath,
  });
  if (!issued.token) {
    return { ok: false, error: issued.error || 'KNOWLEDGE_APPROVAL_TOKEN_INVALID' };
  }
  const payload = {
    spaceId: input.after.spaceId,
    card: input.after,
    permissionMode: input.permissionMode,
    confirmation: { explicitHumanConfirmation: true as const },
    approvalToken: issued.token,
  };
  if (isPromote) {
    await input.api.promote({
      ...payload,
      to: input.action === 'deprecate' ? 'deprecated' : input.action === 'promote-verified' ? 'verified' : 'promoted',
    });
  } else {
    await input.api.write(payload);
  }
  return { ok: true };
}

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
