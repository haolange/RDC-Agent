import { expect, it, vi } from 'vitest';
import type { KnowledgeCardRecord } from '@shared/types/knowledge';
import { issueKnowledgeWrite } from './knowledgeWriteConfirm';

it('routes a human retirement through the promote approval and retired lifecycle', async () => {
  const after: KnowledgeCardRecord = {
    cardId: 'user:facts/sample.md',
    spaceId: 'user',
    relativePath: 'facts/sample.md',
    type: 'fact',
    lifecycle: 'retired',
    title: 'Sample',
    scope: {},
    relations: [],
    body: 'Body',
    updatedAt: 100,
  };
  const issueApprovalToken = vi.fn(async () => ({ token: 'retire-token' }));
  const write = vi.fn(async () => undefined);
  const promote = vi.fn(async () => undefined);
  const result = await issueKnowledgeWrite({
    action: 'retire',
    after,
    openedUpdatedAt: after.updatedAt,
    permissionMode: 'default',
    api: {
      card: vi.fn(async () => ({ card: { updatedAt: after.updatedAt } })),
      issueApprovalToken,
      write,
      promote,
    },
  });
  expect(result).toEqual({ ok: true });
  expect(issueApprovalToken).toHaveBeenCalledWith({
    action: 'knowledge.promote',
    spaceId: after.spaceId,
    relativePath: after.relativePath,
  });
  expect(promote).toHaveBeenCalledWith(expect.objectContaining({ to: 'retired', approvalToken: 'retire-token' }));
  expect(write).not.toHaveBeenCalled();
});
