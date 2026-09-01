import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dialog } from 'electron';

const { handlers, electronState, knowledgeState, writeMocks } = vi.hoisted(() => {
  const registered = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  return {
    handlers: registered,
    electronState: {
      focused: undefined as object | undefined,
      handlers: registered,
    },
    knowledgeState: {
      spaces: [
        { spaceId: 'user', kind: 'user' as const, label: 'User', rootPath: '/user-knowledge' },
        { spaceId: 'project:a', kind: 'project' as const, label: 'A', rootPath: '/proj-a/knowledge', projectId: 'a' },
        { spaceId: 'project:b', kind: 'project' as const, label: 'B', rootPath: '/proj-b/knowledge', projectId: 'b' },
      ],
    },
    writeMocks: {
      write: vi.fn(async (input: { card: unknown }) => input.card),
      promote: vi.fn(async (input: { card: unknown }) => input.card),
    },
  };
});

vi.mock('electron', () => ({
  BrowserWindow: {
    getFocusedWindow: () => electronState.focused,
    getAllWindows: () => [],
  },
  dialog: {
    showMessageBox: vi.fn(async () => ({ response: 0 })),
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, handler);
    },
  },
}));

vi.mock('../knowledge/KnowledgeQueryService', () => ({
  knowledgeQueryService: {
    listSpaces: () => knowledgeState.spaces,
  },
}));

vi.mock('../knowledge/KnowledgeWriteService', () => ({
  knowledgeWriteService: {
    write: writeMocks.write,
    promote: writeMocks.promote,
  },
}));

vi.mock('../knowledge/KnowledgeCandidateService', () => ({
  knowledgeCandidateService: {
    listCandidates: () => [],
    listStagedDrafts: () => [],
  },
}));

vi.mock('../knowledge/KnowledgeCompileService', () => ({
  knowledgeCompileService: { compile: vi.fn() },
}));

vi.mock('../knowledge/KnowledgeIndexService', () => ({
  knowledgeIndexService: { getSnapshot: () => null, rebuild: vi.fn() },
}));

vi.mock('../settings/EmbeddingExecutionService', () => ({
  embeddingExecutionService: {
    resolveSemanticLaneStatus: () => ({ availability: 'unavailable', reason: 'unconfigured' }),
  },
}));

vi.mock('../runtime/RuntimeLogService', () => ({
  runtimeLogService: { log: vi.fn() },
}));

import { registerKnowledgeHandlers } from './knowledgeHandlers';

const sampleCard = {
  cardId: 'project:a:facts/same.md',
  spaceId: 'project:a',
  relativePath: 'facts/same.md',
  type: 'fact' as const,
  lifecycle: 'draft' as const,
  title: 'Same',
  scope: {},
  relations: [],
  body: 'Body',
};

describe('knowledge mutation approval boundaries', () => {
  beforeEach(() => {
    handlers.clear();
    writeMocks.write.mockClear();
    writeMocks.promote.mockClear();
    delete process.env.RDC_AGENT_TEST_MODE;
    delete process.env.RDC_AGENT_BROWSER_QA;
    delete process.env.RDC_AGENT_BROWSER_QA_FULL_ACCESS;
    electronState.focused = undefined;
    registerKnowledgeHandlers({} as never);
  });

  it('rejects headless Browser QA knowledge approval without full access', async () => {
    process.env.RDC_AGENT_BROWSER_QA = '1';
    const result = await handlers.get('knowledge:issueApprovalToken')!({}, {
      action: 'knowledge.write',
      spaceId: 'user',
      relativePath: 'facts/qa.md',
    });
    expect(result).toEqual({ error: 'Knowledge mutation was not confirmed by the main-process dialog.' });
  });

  it('auto-confirms Browser QA knowledge approval only with full access and no owner', async () => {
    process.env.RDC_AGENT_BROWSER_QA = '1';
    process.env.RDC_AGENT_BROWSER_QA_FULL_ACCESS = '1';
    const showMessageBox = vi.mocked(dialog.showMessageBox);
    showMessageBox.mockClear();
    const result = await handlers.get('knowledge:issueApprovalToken')!({}, {
      action: 'knowledge.write',
      spaceId: 'user',
      relativePath: 'facts/qa.md',
    });
    expect(result).toMatchObject({ token: expect.any(String) });
    expect(showMessageBox).not.toHaveBeenCalled();
  });

  it('uses the native dialog when Browser QA has a focused owner', async () => {
    process.env.RDC_AGENT_BROWSER_QA = '1';
    process.env.RDC_AGENT_BROWSER_QA_FULL_ACCESS = '1';
    electronState.focused = {};
    const showMessageBox = vi.mocked(dialog.showMessageBox);
    showMessageBox.mockClear();

    const result = await handlers.get('knowledge:issueApprovalToken')!({}, {
      action: 'knowledge.write',
      spaceId: 'user',
      relativePath: 'facts/focused.md',
    });

    expect(result).toMatchObject({ token: expect.any(String) });
    expect(showMessageBox).toHaveBeenCalledOnce();
  });

  it('uses the native dialog for desktop approval', async () => {
    electronState.focused = {};
    const showMessageBox = vi.mocked(dialog.showMessageBox);
    showMessageBox.mockClear();
    const result = await handlers.get('knowledge:issueApprovalToken')!({}, {
      action: 'knowledge.promote',
      spaceId: 'project:a',
      relativePath: 'facts/desktop.md',
    });
    expect(result).toMatchObject({ token: expect.any(String) });
    expect(showMessageBox).toHaveBeenCalledOnce();
  });

  it('rejects a project A token when writing the same path in project B', async () => {
    process.env.RDC_AGENT_TEST_MODE = '1';
    const issued = await handlers.get('knowledge:issueApprovalToken')!({}, {
      action: 'knowledge.write',
      spaceId: 'project:a',
      relativePath: 'facts/same.md',
    }) as { token?: string };
    expect(issued.token).toEqual(expect.any(String));

    await expect(handlers.get('knowledge:write')!({}, {
      spaceId: 'project:b',
      card: { ...sampleCard, cardId: 'project:b:facts/same.md', spaceId: 'project:b' },
      permissionMode: 'full-access',
      confirmation: { explicitHumanConfirmation: true },
      approvalToken: issued.token,
    })).rejects.toMatchObject({ message: 'KNOWLEDGE_APPROVAL_TOKEN_INVALID' });
    expect(writeMocks.write).not.toHaveBeenCalled();
  });
});
