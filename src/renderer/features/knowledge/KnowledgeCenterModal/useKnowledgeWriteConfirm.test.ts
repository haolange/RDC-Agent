import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeCardRecord, KnowledgePack, KnowledgeQueryRequest } from '@shared/types/knowledge';
import {
  canSubmitKnowledgeWrite,
  collectCardContradicts,
  evaluateWriteGate,
  isWritePackStale,
  isWriteVersionStale,
  issueKnowledgeWrite,
  resolveWriteConfirmPack,
} from './useKnowledgeWriteConfirm';
import { knowledgeQueryKey } from './knowledgeCenterModel';

function card(overrides: Partial<KnowledgeCardRecord> = {}): KnowledgeCardRecord {
  return {
    cardId: 'user:facts/sample.md',
    spaceId: 'user',
    relativePath: 'facts/sample.md',
    type: 'fact',
    lifecycle: 'draft',
    title: 'Sample',
    scope: {},
    relations: [],
    body: 'Body',
    ...overrides,
  };
}

const pack: KnowledgePack = {
  packId: 'pack-1',
  compiledAt: '2026-09-01T00:00:00.000Z',
  hits: [],
  conflicts: [
    { leftCardId: 'user:facts/sample.md', rightCardId: 'user:facts/other.md', kind: 'contradicts' },
    { leftCardId: 'user:facts/a.md', rightCardId: 'user:facts/b.md', kind: 'contradicts' },
  ],
  semanticClaimed: false,
};

describe('evaluateWriteGate', () => {
  it('blocks draft to verified', () => {
    expect(evaluateWriteGate('promote-verified', card())).toBe('draft-to-verified');
  });

  it('blocks case verified when chapters are missing', () => {
    expect(evaluateWriteGate('promote-verified', card({
      type: 'case',
      lifecycle: 'candidate',
      chapters: { claim: 'only claim' },
    }))).toMatch(/^missing-chapters:/);
  });

  it('allows save without lifecycle promotion', () => {
    expect(evaluateWriteGate('save', card({ lifecycle: 'verified' }))).toBeNull();
  });
});

describe('isWriteVersionStale', () => {
  it('blocks create when the target file already exists', () => {
    expect(isWriteVersionStale({ updatedAt: 10 }, undefined)).toBe(true);
  });

  it('blocks when the opened version no longer matches disk', () => {
    expect(isWriteVersionStale({ updatedAt: 20 }, 10)).toBe(true);
  });

  it('allows write when disk is unchanged and no file exists yet', () => {
    expect(isWriteVersionStale({ updatedAt: 10 }, 10)).toBe(false);
    expect(isWriteVersionStale(null, undefined)).toBe(false);
  });
});

describe('collectCardContradicts', () => {
  it('includes pack contradicts that mention the card', () => {
    expect(collectCardContradicts(pack, card())).toEqual([
      { leftCardId: 'user:facts/sample.md', rightCardId: 'user:facts/other.md', kind: 'contradicts' },
    ]);
  });

  it('includes the card own contradicts relations', () => {
    expect(collectCardContradicts(null, card({
      relations: [{ kind: 'contradicts', targetCardId: 'user:facts/rival.md' }],
    }))).toEqual([
      { leftCardId: 'user:facts/sample.md', rightCardId: 'user:facts/rival.md', kind: 'contradicts' },
    ]);
  });

  it('returns empty when there is no conflict', () => {
    expect(collectCardContradicts(null, card())).toEqual([]);
  });
});

describe('resolveWriteConfirmPack', () => {
  const queryRequest: KnowledgeQueryRequest = { spaceIds: ['user'], text: 'sample' };

  it('treats a missing pack as stale', () => {
    expect(isWritePackStale(null, null, queryRequest)).toBe(true);
  });

  it('treats a pack compiled for another query as stale', () => {
    expect(isWritePackStale(pack, knowledgeQueryKey({ spaceIds: ['user'] }), queryRequest)).toBe(true);
    expect(isWritePackStale(pack, knowledgeQueryKey(queryRequest), queryRequest)).toBe(false);
  });

  it('recompiles when Cards never visited Conflicts', async () => {
    const compile = vi.fn(async () => pack);
    await expect(resolveWriteConfirmPack({
      pack: null,
      packQueryKey: null,
      queryRequest,
      compile,
    })).resolves.toBe(pack);
    expect(compile).toHaveBeenCalledWith({ ...queryRequest, limit: 50 });
  });

  it('reuses a fresh pack without compiling again', async () => {
    const compile = vi.fn(async () => pack);
    await expect(resolveWriteConfirmPack({
      pack,
      packQueryKey: knowledgeQueryKey(queryRequest),
      queryRequest,
      compile,
    })).resolves.toBe(pack);
    expect(compile).not.toHaveBeenCalled();
  });
});

describe('Cards write confirm without visiting Conflicts', () => {
  const queryRequest: KnowledgeQueryRequest = { spaceIds: ['user'] };
  const compiled: KnowledgePack = {
    packId: 'pack-cards',
    compiledAt: '2026-09-01T00:00:00.000Z',
    hits: [],
    conflicts: [
      { leftCardId: 'user:facts/other.md', rightCardId: 'user:facts/sample.md', kind: 'contradicts' },
    ],
    semanticClaimed: false,
  };

  it('requires acknowledge for compile-derived contradicts before issuing a write token', async () => {
    const compile = vi.fn(async () => compiled);
    const gatePack = await resolveWriteConfirmPack({
      pack: null,
      packQueryKey: null,
      queryRequest,
      compile,
    });
    const target = card({ relations: [] });
    const contradicts = collectCardContradicts(gatePack, target);
    expect(compile).toHaveBeenCalledWith({ ...queryRequest, limit: 50 });
    expect(contradicts).toEqual([
      { leftCardId: 'user:facts/other.md', rightCardId: 'user:facts/sample.md', kind: 'contradicts' },
    ]);

    const ready = { after: target, changeReason: 'keep both claims', confirmed: true, contradicts, packReady: true };
    expect(canSubmitKnowledgeWrite({ ...ready, acknowledgedConflicts: false })).toBe(false);
    expect(canSubmitKnowledgeWrite({ ...ready, acknowledgedConflicts: true })).toBe(true);

    const issueApprovalToken = vi.fn(async () => ({ token: 'tok-1' }));
    const write = vi.fn(async () => undefined);
    const promote = vi.fn(async () => undefined);
    const api = {
      card: vi.fn(async () => ({ card: null })),
      issueApprovalToken,
      write,
      promote,
    };

    if (!canSubmitKnowledgeWrite({ ...ready, acknowledgedConflicts: false })) {
      expect(issueApprovalToken).not.toHaveBeenCalled();
    }

    const issued = await issueKnowledgeWrite({
      action: 'save',
      after: target,
      openedUpdatedAt: undefined,
      permissionMode: 'default',
      api,
    });
    expect(issued).toEqual({ ok: true });
    expect(issueApprovalToken).toHaveBeenCalledWith({
      action: 'knowledge.write',
      spaceId: 'user',
      relativePath: 'facts/sample.md',
    });
    expect(write).toHaveBeenCalled();
    expect(promote).not.toHaveBeenCalled();
  });
});
