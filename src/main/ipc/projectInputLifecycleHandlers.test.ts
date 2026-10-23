import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkbenchIpcContext } from './workbenchContext';

const mocks = vi.hoisted(() => ({
  changed: undefined as undefined | ((event: string, filename: string | null) => void),
  quit: undefined as undefined | (() => void),
  close: vi.fn(),
  refresh: vi.fn(async () => []),
  language: 'zh-CN',
  owner: {} as object | undefined,
  confirm: vi.fn(async () => ({ response: 0 })),
  prepare: vi.fn(),
  remove: vi.fn(),
  handlers: new Map<string, (...args: unknown[]) => Promise<Record<string, unknown>>>(),
}));
vi.mock('electron', () => ({
  app: { once: (_: string, callback: () => void) => { mocks.quit = callback; } },
  BrowserWindow: { getFocusedWindow: () => mocks.owner }, dialog: { showMessageBox: mocks.confirm },
  ipcMain: { handle: (name: string, handler: (...args: unknown[]) => Promise<Record<string, unknown>>) => mocks.handlers.set(name, handler) },
}));
vi.mock('node:fs', () => ({ watch: (_: string, _options: unknown, callback: typeof mocks.changed) => {
  mocks.changed = callback;
  return { on: vi.fn(), close: mocks.close };
} }));
vi.mock('../captures/ProjectInputLifecycle', () => ({ ProjectInputLifecycle: class {
  reconcile = vi.fn(); prepare = mocks.prepare; remove = mocks.remove;
} }));
vi.mock('../captures/replay/ReplayHistoryStore', () => ({ replayHistoryStore: {} }));
vi.mock('../sessions/StorageAdapter', () => ({ storageAdapter: {
  projects: { setInputReconciler: vi.fn(), setInputCommitListener: vi.fn() },
  listProjects: () => [{ projectId: 'project', rootPath: 'D:/fixture' }],
  refreshProjectInputs: (...args: []) => mocks.refresh(...args),
} }));
vi.mock('../sessions', () => ({ rdcSessionService: {} }));
vi.mock('../conversation/ConversationService', () => ({ conversationService: {} }));
vi.mock('../runtime/RuntimeLogService', () => ({ runtimeLogService: { log: vi.fn() } }));
vi.mock('../settings/SettingsService', () => ({ settingsService: {
  getAll: () => ({ appearance: { language: mocks.language } }),
} }));

import { registerProjectInputLifecycleHandlers } from './projectInputLifecycleHandlers';

describe('project input file watching', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.refresh.mockClear(); mocks.close.mockClear();
  });
  afterEach(() => { mocks.quit?.(); vi.useRealTimers(); });

  it('settles after reconciliation writes metadata and Windows reports its parent directory', async () => {
    mocks.refresh.mockImplementation(async () => {
      for (const filename of ['.rdc-agent', '.rdc-agent/project.yaml', '.rdc-agent/replay.lock', '.rdc-agent/.replay-lock.pending']) {
        mocks.changed!('change', filename);
      }
      return [];
    });
    registerProjectInputLifecycleHandlers({ broadcastToRenderer: vi.fn() } as unknown as WorkbenchIpcContext);
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    mocks.quit!();
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it('reconciles input creation, edits, deletion and resource-root replacement, coalescing bursts', async () => {
    mocks.refresh.mockResolvedValue([]);
    registerProjectInputLifecycleHandlers({ broadcastToRenderer: vi.fn() } as unknown as WorkbenchIpcContext);
    await vi.advanceTimersByTimeAsync(250);
    mocks.refresh.mockClear();
    for (const [event, filename] of [
      ['rename', '.rdc-agent\\inputs\\new.rdc'], ['change', '.RDC-Agent/inputs/new.rdc'],
      ['rename', '.rdc-agent/inputs/new.rdc'], ['rename', '.rdc-agent/inputs'], ['rename', '.rdc-agent'],
    ]) {
      mocks.changed!(event, filename);
      mocks.changed!(event, filename);
      await vi.advanceTimersByTimeAsync(250);
    }
    expect(mocks.refresh).toHaveBeenCalledTimes(5);
    mocks.changed!('change', 'unrelated.rdc'); mocks.changed!('rename', null);
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.refresh).toHaveBeenCalledTimes(5);
    mocks.changed!('change', '.rdc-agent/inputs/new.rdc');
    mocks.quit!();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.refresh).toHaveBeenCalledTimes(5);
  });
});

describe('native project input removal approval', () => {
  const invoke = (name: string, ...args: unknown[]) => mocks.handlers.get(`project:inputs:${name}`)!({}, ...args);
  beforeEach(() => {
    vi.useFakeTimers(); vi.unstubAllEnvs();
    mocks.language = 'zh-CN'; mocks.owner = {};
    mocks.confirm.mockReset().mockResolvedValue({ response: 0 });
    mocks.prepare.mockReset().mockResolvedValue({
      input: { fileName: 'capture.rdc', filePath: 'D:/original/capture.rdc', source: 'external_reference' },
      project: { rootPath: 'D:/fixture' }, affectedSessionIds: ['session'], approvalIdentity: 'external:identity',
    });
    mocks.remove.mockReset().mockResolvedValue({ success: true, inputs: [], fileDeleted: false });
    registerProjectInputLifecycleHandlers({ broadcastToRenderer: vi.fn() } as unknown as WorkbenchIpcContext);
  });
  afterEach(() => { mocks.quit?.(); vi.useRealTimers(); vi.unstubAllEnvs(); });

  it.each(['zh-CN', 'en'])('localizes the entire reference confirmation in %s', async language => {
    mocks.language = language;
    expect((await invoke('prepareRemove', 'project', 'input')).success).toBe(true);
    const options = mocks.confirm.mock.calls[0] as unknown as [object, { buttons: string[]; title: string; message: string; detail: string; defaultId: number; cancelId: number }];
    expect(options[1]).toMatchObject({ defaultId: 1, cancelId: 1 });
    if (language === 'en') {
      expect(options[1].buttons).toEqual(['Remove reference', 'Cancel']);
      expect(options[1].title).toBe('Remove external capture reference');
      expect(options[1].message).toBe('Remove reference capture.rdc?');
      expect(options[1].detail).toContain('The external RDC original will be kept.');
      expect(options[1].detail).toContain('Associated sessions: session');
      expect(JSON.stringify(options[1])).not.toMatch(/[\u4e00-\u9fff]/u);
    } else {
      expect(options[1].buttons).toEqual(['移除引用', '取消']);
      expect(options[1].title).toBe('移除外部抓帧引用');
      expect(options[1].detail).toContain('保留外部 RDC 原件');
    }
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('reads the current language for every dialog and preserves project-file deletion wording', async () => {
    await invoke('prepareRemove', 'project', 'input');
    mocks.language = 'en';
    const prepared = await mocks.prepare();
    mocks.prepare.mockResolvedValue({ ...prepared, input: { ...prepared.input, source: 'project_resource' } });
    await invoke('prepareRemove', 'project', 'input');
    const options = (mocks.confirm.mock.calls[1] as unknown as [object, { title: string; buttons: string[]; detail: string }])[1];
    expect(options.title).toBe('Delete project capture'); expect(options.buttons).toEqual(['Delete capture', 'Cancel']);
    expect(options.detail).toContain('this RDC file will be deleted.');
    expect(options.detail).not.toContain('external RDC original');
  });

  it('retains Chinese project-file deletion and omits an empty session list', async () => {
    const prepared = await mocks.prepare();
    mocks.prepare.mockResolvedValue({ ...prepared, input: { ...prepared.input, source: 'project_resource' }, affectedSessionIds: [] });
    await invoke('prepareRemove', 'project', 'input');
    const options = (mocks.confirm.mock.calls[0] as unknown as [object, { title: string; buttons: string[]; detail: string }])[1];
    expect(options.title).toBe('删除项目抓帧'); expect(options.buttons).toEqual(['删除抓帧', '取消']);
    expect(options.detail).toContain('删除这个 RDC 文件'); expect(options.detail).not.toContain('关联会话');
  });

  it('cancellation issues no token, while confirmation authorizes exactly one removal', async () => {
    mocks.confirm.mockResolvedValueOnce({ response: 1 });
    expect(await invoke('prepareRemove', 'project', 'input')).toEqual({ success: false });
    const approved = await invoke('prepareRemove', 'project', 'input');
    expect(typeof approved.approvalToken).toBe('string');
    expect(await invoke('remove', 'project', 'input', approved.approvalToken)).toMatchObject({ success: true, fileDeleted: false });
    expect(await invoke('remove', 'project', 'input', approved.approvalToken)).toMatchObject({ success: false, error: 'PROJECT_INPUT_APPROVAL_INVALID' });
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith('project', 'input', 'external:identity');
  });

  it('fails closed without an owner and does not mistake Browser auto-confirmation for a native dialog', async () => {
    mocks.owner = undefined;
    expect(await invoke('prepareRemove', 'project', 'input')).toEqual({ success: false });
    vi.stubEnv('RDC_AGENT_BROWSER_QA', '1'); vi.stubEnv('RDC_AGENT_BROWSER_QA_FULL_ACCESS', '1');
    expect((await invoke('prepareRemove', 'project', 'input')).success).toBe(true);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
});
