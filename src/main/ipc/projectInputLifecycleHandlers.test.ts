import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkbenchIpcContext } from './workbenchContext';

const mocks = vi.hoisted(() => ({
  changed: undefined as undefined | ((event: string, filename: string | null) => void),
  quit: undefined as undefined | (() => void),
  close: vi.fn(),
  refresh: vi.fn(async () => []),
}));
vi.mock('electron', () => ({
  app: { once: (_: string, callback: () => void) => { mocks.quit = callback; } },
  BrowserWindow: {}, dialog: {}, ipcMain: { handle: vi.fn() },
}));
vi.mock('node:fs', () => ({ watch: (_: string, _options: unknown, callback: typeof mocks.changed) => {
  mocks.changed = callback;
  return { on: vi.fn(), close: mocks.close };
} }));
vi.mock('../captures/ProjectInputLifecycle', () => ({ ProjectInputLifecycle: class { reconcile = vi.fn(); } }));
vi.mock('../captures/replay/ReplayHistoryStore', () => ({ replayHistoryStore: {} }));
vi.mock('../sessions/StorageAdapter', () => ({ storageAdapter: {
  projects: { setInputReconciler: vi.fn(), setInputCommitListener: vi.fn() },
  listProjects: () => [{ projectId: 'project', rootPath: 'D:/fixture' }],
  refreshProjectInputs: (...args: []) => mocks.refresh(...args),
} }));
vi.mock('../sessions', () => ({ rdcSessionService: {} }));
vi.mock('../conversation/ConversationService', () => ({ conversationService: {} }));
vi.mock('../runtime/RuntimeLogService', () => ({ runtimeLogService: { log: vi.fn() } }));
vi.mock('./validation/IpcApprovalTokenService', () => ({ ipcApprovalTokenService: {} }));

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
