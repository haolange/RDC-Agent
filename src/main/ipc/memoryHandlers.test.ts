import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dialog } from 'electron';

const { handlers, electronState } = vi.hoisted(() => {
  const registered = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const state: { focused: object | undefined } = { focused: undefined };
  return {
    handlers: registered,
    electronState: {
      ...state,
      handlers: registered,
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

import { registerMemoryHandlers } from './memoryHandlers';

describe('memory mutation approval boundaries', () => {
  beforeEach(() => {
    handlers.clear();
    delete process.env.RDC_AGENT_TEST_MODE;
    delete process.env.RDC_AGENT_BROWSER_QA;
    delete process.env.RDC_AGENT_BROWSER_QA_FULL_ACCESS;
    electronState.focused = undefined;
    registerMemoryHandlers({} as never);
  });

  it('rejects headless Browser QA memory approval without full access', async () => {
    process.env.RDC_AGENT_BROWSER_QA = '1';
    const result = await handlers.get('memory:issueApprovalToken')!({ }, {
      action: 'memory.write',
      scope: 'user',
      name: 'qa-memory',
    });
    expect(result).toEqual({ error: 'Memory mutation was not confirmed by the main-process dialog.' });
  });

  it('auto-confirms Browser QA memory approval only with full access', async () => {
    process.env.RDC_AGENT_BROWSER_QA = '1';
    process.env.RDC_AGENT_BROWSER_QA_FULL_ACCESS = '1';
    const result = await handlers.get('memory:issueApprovalToken')!({ }, {
      action: 'memory.write',
      scope: 'user',
      name: 'qa-memory',
    });
    expect(result).toMatchObject({ token: expect.any(String) });
  });

  it('uses the native dialog when Browser QA has a focused owner', async () => {
    process.env.RDC_AGENT_BROWSER_QA = '1';
    process.env.RDC_AGENT_BROWSER_QA_FULL_ACCESS = '1';
    electronState.focused = {};
    const showMessageBox = vi.mocked(dialog.showMessageBox);
    showMessageBox.mockClear();

    const result = await handlers.get('memory:issueApprovalToken')!({ }, {
      action: 'memory.write',
      scope: 'user',
      name: 'focused-qa-memory',
    });

    expect(result).toMatchObject({ token: expect.any(String) });
    expect(showMessageBox).toHaveBeenCalledOnce();
  });

  it('uses the native dialog for desktop approval', async () => {
    electronState.focused = {};
    const result = await handlers.get('memory:issueApprovalToken')!({ }, {
      action: 'memory.delete',
      scope: 'project',
      name: 'desktop-memory',
    });
    expect(result).toMatchObject({ token: expect.any(String) });
  });
});
