import {
  KNOWLEDGE_CASE_CHAPTERS,
  type KnowledgeCardRecord,
  type KnowledgePack,
  type KnowledgePackConflict,
  type KnowledgeQueryRequest,
} from '@shared/types/knowledge';
import type { AgentPermissionMode } from '@shared/types/settings';
import { knowledgeQueryKey, type KnowledgeWriteAction } from './knowledgeCenterModel';

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
