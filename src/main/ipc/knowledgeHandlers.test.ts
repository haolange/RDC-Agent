vi.mock('../settings/settings-core/SettingsService', () => ({ settingsService: { getAll: () => ({ appearance: { language: electronState.language } }) } }));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dialog } from 'electron';

const { handlers, electronState, knowledgeState, writeMocks, topicMocks } = vi.hoisted(() => {
  const registered = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  return {
    handlers: registered,
    electronState: {
      focused: undefined as object | undefined,
      handlers: registered,
      language: 'zh-CN',
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
    topicMocks: {
      preview: vi.fn(async () => ({ changeHash: 'a'.repeat(64), topics: [{ label: 'Texture' }], cards: [] })),
      apply: vi.fn(async () => ({ revision: 'b'.repeat(64) })),
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

vi.mock('../knowledge/KnowledgeTopicService', () => ({ knowledgeTopicService: topicMocks }));

vi.mock('../knowledge/KnowledgeCandidateService', () => ({
  knowledgeCandidateService: {
    listCandidates: () => [],
  },
}));

vi.mock('../knowledge/KnowledgeImportService', () => ({
  knowledgeImportService: {
    importToSpace: vi.fn(async () => ({ candidateCreated: false, verified: false, items: [] })),
    migrateSessionDrafts: vi.fn(async () => undefined),
  },
}));

vi.mock('../knowledge/KnowledgeCompileService', () => ({
  knowledgeCompileService: { compile: vi.fn() },
}));

vi.mock('../knowledge/KnowledgeIndexService', () => ({
  knowledgeIndexService: { getSnapshot: () => null, rebuild: vi.fn() },
}));

vi.mock('../runtime/RuntimeLogService', () => ({
  runtimeLogService: { log: vi.fn() },
}));

import { knowledgeImportService } from '../knowledge/KnowledgeImportService';
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
    topicMocks.preview.mockClear();
    topicMocks.apply.mockClear();
    vi.mocked(knowledgeImportService.importToSpace).mockClear();
    vi.mocked(knowledgeImportService.migrateSessionDrafts).mockClear();
    delete process.env.RDC_AGENT_BROWSER_QA;
    delete process.env.RDC_AGENT_BROWSER_QA_FULL_ACCESS;
    electronState.focused = undefined;
    registerKnowledgeHandlers({} as never);
  });

  it('requires a matching preview and main-process human confirmation before applying topic changes', async () => {
    const changes = { expectedRevision: 'c'.repeat(64), expectedCorpusRevision: 'd'.repeat(64),
      topics: [{ id: 'texture', label: 'Texture', synonyms: ['纹理'] }], assignments: [] };
    const request = { changes, changeHash: 'a'.repeat(64), confirmation: { explicitHumanConfirmation: true } };
    const apply = handlers.get('knowledge:topics:apply')!;
    await expect(apply({}, { ...request, confirmation: { explicitHumanConfirmation: false } })).rejects.toThrow();
    await expect(apply({}, { ...request, changeHash: 'b'.repeat(64) })).rejects.toThrow('PREVIEW_CHANGED');
    expect(topicMocks.apply).not.toHaveBeenCalled();
    expect(await apply({}, request)).toEqual({ cancelled: true });
    expect(topicMocks.apply).not.toHaveBeenCalled();
    electronState.focused = {};
    vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 0, checkboxChecked: false });
    expect(await apply({}, request)).toEqual({ revision: 'b'.repeat(64) });
    expect(topicMocks.apply).toHaveBeenCalledOnce();
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
    electronState.focused = {};
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

  it('imports into the chosen space without a second write dialog', async () => {
    const imported = {
      candidateCreated: false as const,
      verified: false as const,
      items: [{
        status: 'draft' as const,
        lifecycle: 'draft' as const,
        missingAssets: [],
        record: { ...sampleCard, spaceId: 'user', cardId: 'user:facts/same.md' },
      }],
    };
    vi.mocked(knowledgeImportService.importToSpace).mockResolvedValueOnce(imported);
    const result = await handlers.get('knowledge:import')!({}, {
      spaceId: 'user',
      source: 'case_id: same\ntitle: Same\nsymptoms: darker',
    });
    expect(result).toEqual(imported);
    expect(knowledgeImportService.migrateSessionDrafts).not.toHaveBeenCalled();
    expect(knowledgeImportService.importToSpace).toHaveBeenCalledWith({
      spaceId: 'user',
      source: 'case_id: same\ntitle: Same\nsymptoms: darker',
    });
    expect(writeMocks.write).not.toHaveBeenCalled();
  });
});

it.each([['zh-CN', '确认更改知识', '取消'], ['en', 'Confirm knowledge change', 'Cancel']])('localizes %s native confirmation and issues no token after cancellation', async (language, title, cancel) => {
  delete process.env.RDC_AGENT_BROWSER_QA;
  registerKnowledgeHandlers({} as never);
  electronState.focused = {};
  electronState.language = language;
  vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 1, checkboxChecked: false });
  const result = await handlers.get('knowledge:issueApprovalToken')!({}, { action: 'knowledge.write', spaceId: 'user', relativePath: 'facts/language.md' });
  expect(result).not.toHaveProperty('token');
  expect(dialog.showMessageBox).toHaveBeenLastCalledWith(expect.any(Object), expect.objectContaining({
    title, buttons: [expect.any(String), cancel], defaultId: 1, cancelId: 1,
  }));
});
