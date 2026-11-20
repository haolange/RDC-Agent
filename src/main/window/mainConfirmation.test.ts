import { afterEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({
  focused: undefined as object | undefined,
  showMessageBox: vi.fn(async () => ({ response: 1 })),
}));
vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: () => electron.focused },
  dialog: { showMessageBox: electron.showMessageBox },
}));
vi.mock('../runtime/RuntimeLogService', () => ({ runtimeLogService: { log: vi.fn() } }));

import { confirmInMainProcess } from './mainConfirmation';

const request = {
  action: 'trust.mcp', title: 'Trust a project resource', message: 'Let MCP server "docs" start?',
  detail: '/project/.rdc-agent/mcp/docs.mcp.json', confirmLabel: 'Trust', cancelLabel: 'Cancel',
};

describe('main-process confirmation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    electron.focused = undefined;
    electron.showMessageBox.mockReset();
  });

  it('confirms nothing without a window, unless Browser QA explicitly runs with full access', async () => {
    await expect(confirmInMainProcess(request)).resolves.toBe(false);
    vi.stubEnv('RDC_AGENT_BROWSER_QA', '1');
    await expect(confirmInMainProcess(request)).resolves.toBe(false);
    vi.stubEnv('RDC_AGENT_BROWSER_QA_FULL_ACCESS', '1');
    await expect(confirmInMainProcess(request)).resolves.toBe(true);
    expect(electron.showMessageBox).not.toHaveBeenCalled();
  });

  it('asks in a native dialog that defaults to cancel', async () => {
    electron.focused = {};
    electron.showMessageBox.mockResolvedValueOnce({ response: 1 }).mockResolvedValueOnce({ response: 0 });
    await expect(confirmInMainProcess(request)).resolves.toBe(false);
    await expect(confirmInMainProcess(request)).resolves.toBe(true);
    expect(electron.showMessageBox).toHaveBeenCalledWith(electron.focused, expect.objectContaining({
      buttons: ['Trust', 'Cancel'], defaultId: 1, cancelId: 1, detail: request.detail,
    }));
  });
});
