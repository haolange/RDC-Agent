vi.mock('../settings/settings-core/SettingsService', () => ({
  settingsService: { snapshot: () => ({ revision: 1, user: { appearance: { language: electronState.language } } }) },
}));
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
  app: { isPackaged: false },
  BrowserWindow: {
    getFocusedWindow: () => electronState.focused,
    getAllWindows: () => [],
  },
  dialog: {
    showMessageBox: vi.fn(async () => ({ response: 0 })),
    showSaveDialog: vi.fn(async () => ({ canceled: true })),
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
    previewImport: vi.fn(async () => ({ candidateCreated: false, verified: false, items: [] })),
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
import { knowledgeIndexService } from '../knowledge/KnowledgeIndexService';
import { registerKnowledgeHandlers } from './knowledgeHandlers';
import type { KnowledgeOperationOptions } from '../knowledge/knowledgeOperations';

const broadcastToRenderer = vi.fn();
const context = { broadcastToRenderer } as never;

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
const cardAt = (spaceId: string, relativePath: string) => ({
  ...sampleCard,
  cardId: `${spaceId}:${relativePath}`,
  spaceId,
  relativePath,
});

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
    broadcastToRenderer.mockClear();
    registerKnowledgeHandlers(context);
  });

  it('requires a matching preview and main-process human confirmation before applying topic changes', async () => {
    const changes = {
      expectedRevision: 'c'.repeat(64),
      expectedCorpusRevision: 'd'.repeat(64),
      topics: [{ id: 'texture', label: 'Texture', synonyms: ['纹理'] }],
      assignments: [],
    };
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
    const result = await handlers.get('knowledge:issueApprovalToken')!(
      {},
      {
        action: 'knowledge.write',
        spaceId: 'user',
        card: cardAt('user', 'facts/qa.md'),
      },
    );
    expect(result).toEqual({ error: 'Knowledge mutation was not confirmed by the main-process dialog.' });
  });

  it('auto-confirms Browser QA knowledge approval only with full access and no owner', async () => {
    process.env.RDC_AGENT_BROWSER_QA = '1';
    process.env.RDC_AGENT_BROWSER_QA_FULL_ACCESS = '1';
    const showMessageBox = vi.mocked(dialog.showMessageBox);
    showMessageBox.mockClear();
    const result = await handlers.get('knowledge:issueApprovalToken')!(
      {},
      {
        action: 'knowledge.write',
        spaceId: 'user',
        card: cardAt('user', 'facts/qa.md'),
      },
    );
    expect(result).toMatchObject({ token: expect.any(String) });
    expect(showMessageBox).not.toHaveBeenCalled();
  });

  it('uses the native dialog when Browser QA has a focused owner', async () => {
    process.env.RDC_AGENT_BROWSER_QA = '1';
    process.env.RDC_AGENT_BROWSER_QA_FULL_ACCESS = '1';
    electronState.focused = {};
    const showMessageBox = vi.mocked(dialog.showMessageBox);
    showMessageBox.mockClear();

    const result = await handlers.get('knowledge:issueApprovalToken')!(
      {},
      {
        action: 'knowledge.write',
        spaceId: 'user',
        card: cardAt('user', 'facts/focused.md'),
      },
    );

    expect(result).toMatchObject({ token: expect.any(String) });
    expect(showMessageBox).toHaveBeenCalledOnce();
  });

  it('uses the native dialog for desktop approval', async () => {
    electronState.focused = {};
    const showMessageBox = vi.mocked(dialog.showMessageBox);
    showMessageBox.mockClear();
    const result = await handlers.get('knowledge:issueApprovalToken')!(
      {},
      {
        action: 'knowledge.promote',
        spaceId: 'project:a',
        card: cardAt('project:a', 'facts/desktop.md'),
      },
    );
    expect(result).toMatchObject({ token: expect.any(String) });
    expect(showMessageBox).toHaveBeenCalledOnce();
  });

  it('rejects a project A token when writing the same path in project B', async () => {
    electronState.focused = {};
    const issued = (await handlers.get('knowledge:issueApprovalToken')!(
      {},
      {
        action: 'knowledge.write',
        spaceId: 'project:a',
        card: cardAt('project:a', 'facts/same.md'),
      },
    )) as { token?: string };
    expect(issued.token).toEqual(expect.any(String));

    await expect(
      handlers.get('knowledge:write')!(
        {},
        {
          spaceId: 'project:b',
          card: { ...sampleCard, cardId: 'project:b:facts/same.md', spaceId: 'project:b' },
          permissionMode: 'full-access',
          confirmation: { explicitHumanConfirmation: true },
          approvalToken: issued.token,
        },
      ),
    ).rejects.toMatchObject({ message: 'KNOWLEDGE_APPROVAL_TOKEN_INVALID' });
    expect(writeMocks.write).not.toHaveBeenCalled();
  });

  it('binds a token to the approved card so a different card or a second use is refused', async () => {
    electronState.focused = {};
    const approved = cardAt('project:a', 'facts/same.md');
    const issue = async () =>
      (
        (await handlers.get('knowledge:issueApprovalToken')!(
          {},
          {
            action: 'knowledge.write',
            spaceId: 'project:a',
            card: approved,
          },
        )) as { token: string }
      ).token;
    const write = (card: typeof approved, approvalToken: string) =>
      handlers.get('knowledge:write')!(
        {},
        {
          spaceId: 'project:a',
          card,
          permissionMode: 'full-access',
          confirmation: { explicitHumanConfirmation: true },
          approvalToken,
        },
      );

    await expect(write({ ...approved, body: 'Swapped after approval' }, await issue())).rejects.toMatchObject({
      message: 'KNOWLEDGE_APPROVAL_TOKEN_INVALID',
    });
    const token = await issue();
    await write(approved, token);
    await expect(write(approved, token)).rejects.toMatchObject({ message: 'KNOWLEDGE_APPROVAL_TOKEN_INVALID' });
    expect(writeMocks.write).toHaveBeenCalledOnce();
  });

  it('imports into the chosen space only after the person confirms in main', async () => {
    const imported = {
      candidateCreated: false as const,
      verified: false as const,
      items: [
        {
          status: 'draft' as const,
          lifecycle: 'draft' as const,
          missingAssets: [],
          record: { ...sampleCard, spaceId: 'user', cardId: 'user:facts/same.md' },
        },
      ],
    };
    vi.mocked(knowledgeImportService.importToSpace).mockResolvedValueOnce(imported);
    const source = { spaceId: 'user', source: 'case_id: same\ntitle: Same\nsymptoms: darker' };
    const request = { ...source, operationId: 'op-import' };

    // No window to confirm in: nothing is written.
    await expect(handlers.get('knowledge:import')!({}, request)).resolves.toEqual({ cancelled: true });
    expect(knowledgeImportService.importToSpace).not.toHaveBeenCalled();

    electronState.focused = {};
    vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 1, checkboxChecked: false });
    await expect(handlers.get('knowledge:import')!({}, request)).resolves.toEqual({ cancelled: true });
    expect(knowledgeImportService.importToSpace).not.toHaveBeenCalled();

    vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 0, checkboxChecked: false });
    await expect(handlers.get('knowledge:import')!({}, request)).resolves.toEqual(imported);
    expect(knowledgeImportService.migrateSessionDrafts).not.toHaveBeenCalled();
    expect(knowledgeImportService.importToSpace).toHaveBeenCalledWith(
      source,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(writeMocks.write).not.toHaveBeenCalled();
  });

  it('previews an import without asking for confirmation or writing anything', async () => {
    const request = { spaceId: 'user', source: 'case_id: same\ntitle: Same\nsymptoms: darker' };
    const confirmations = vi.mocked(dialog.showMessageBox).mock.calls.length;
    await handlers.get('knowledge:previewImport')!({}, request);
    expect(knowledgeImportService.previewImport).toHaveBeenCalledWith(request);
    expect(vi.mocked(dialog.showMessageBox).mock.calls.length).toBe(confirmations);
    expect(knowledgeImportService.importToSpace).not.toHaveBeenCalled();
    await expect(
      handlers.get('knowledge:previewImport')!({}, { spaceId: 'project:unknown', source: 'x' }),
    ).rejects.toThrow();
  });
});

describe('knowledge operation progress and cancellation', () => {
  beforeEach(() => {
    handlers.clear();
    broadcastToRenderer.mockClear();
    vi.mocked(knowledgeImportService.importToSpace).mockClear();
    electronState.focused = {};
    registerKnowledgeHandlers(context);
  });

  it('reports rebuild progress on knowledge:progress and rejects a cancelled rebuild with the registered code', async () => {
    let reached!: () => void;
    const atSecondCard = new Promise<void>((resolve) => {
      reached = resolve;
    });
    vi.mocked(knowledgeIndexService.rebuild).mockImplementationOnce(async (options: KnowledgeOperationOptions = {}) => {
      for (let done = 0; done < 3; done += 1) {
        options.signal?.throwIfAborted();
        options.onProgress?.('indexing', done, 3);
        if (done === 1) {
          reached();
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      throw new Error('a cancelled rebuild must not finish');
    });
    const running = handlers.get('knowledge:index:rebuild')!({}, { operationId: 'op-rebuild' });
    await atSecondCard;
    await expect(handlers.get('knowledge:cancel')!({}, { operationId: 'op-rebuild' })).resolves.toEqual({
      cancelled: true,
    });
    await expect(running).rejects.toMatchObject({ code: 'KNOWLEDGE_OPERATION_CANCELLED' });
    const events = broadcastToRenderer.mock.calls
      .filter(([channel]) => channel === 'knowledge:progress')
      .map(([, event]) => event);
    expect(events[0]).toEqual({ operationId: 'op-rebuild', phase: 'indexing', done: 0, total: 3 });
    // The report that waited for its window is still delivered when the run settles.
    expect(events.at(-1)).toEqual({ operationId: 'op-rebuild', phase: 'indexing', done: 1, total: 3 });
    await expect(handlers.get('knowledge:cancel')!({}, { operationId: 'op-rebuild' })).resolves.toEqual({
      cancelled: false,
    });
  });

  it('cancels an export after the save dialog without writing, and a cancelled save dialog stays a plain null', async () => {
    const request = { format: 'markdown', scope: 'space', spaceId: 'user', operationId: 'op-export' };
    await expect(handlers.get('knowledge:export')!({}, request)).resolves.toBeNull();
    let choose!: (value: { canceled: boolean; filePath: string }) => void;
    vi.mocked(dialog.showSaveDialog).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          choose = resolve as typeof choose;
        }),
    );
    const running = handlers.get('knowledge:export')!({}, request);
    await vi.waitFor(() => expect(choose).toBeTypeOf('function'));
    await expect(handlers.get('knowledge:cancel')!({}, { operationId: 'op-export' })).resolves.toEqual({
      cancelled: true,
    });
    choose({ canceled: false, filePath: '/exports/knowledge-export.md' });
    await expect(running).rejects.toMatchObject({ code: 'KNOWLEDGE_OPERATION_CANCELLED' });
  });

  it('refuses a long operation without an operation id', async () => {
    const rebuilds = vi.mocked(knowledgeIndexService.rebuild).mock.calls.length;
    await expect(handlers.get('knowledge:index:rebuild')!({})).rejects.toThrow();
    await expect(
      handlers.get('knowledge:import')!({}, { spaceId: 'user', source: 'case_id: a\ntitle: A' }),
    ).rejects.toThrow();
    expect(vi.mocked(knowledgeIndexService.rebuild).mock.calls.length).toBe(rebuilds);
    expect(knowledgeImportService.importToSpace).not.toHaveBeenCalled();
  });
});

it.each([
  ['zh-CN', '确认更改知识', '取消'],
  ['en', 'Confirm knowledge change', 'Cancel'],
])('localizes %s native confirmation and issues no token after cancellation', async (language, title, cancel) => {
  delete process.env.RDC_AGENT_BROWSER_QA;
  registerKnowledgeHandlers(context);
  electronState.focused = {};
  electronState.language = language;
  vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 1, checkboxChecked: false });
  const result = await handlers.get('knowledge:issueApprovalToken')!(
    {},
    { action: 'knowledge.write', spaceId: 'user', card: cardAt('user', 'facts/language.md') },
  );
  expect(result).not.toHaveProperty('token');
  expect(dialog.showMessageBox).toHaveBeenLastCalledWith(
    expect.any(Object),
    expect.objectContaining({
      title,
      buttons: [expect.any(String), cancel],
      defaultId: 1,
      cancelId: 1,
    }),
  );
});
