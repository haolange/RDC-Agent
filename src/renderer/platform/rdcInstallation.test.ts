import { beforeEach, expect, it, vi } from 'vitest';
import { validateRdcInstallation, selectRdcInstallation } from './rdcInstallation';
const cli = { root: 'C:/Tools space/工具', env: {}, timeoutMs: 30000 };
const summary = { cli: { available: true }, runtime: { version: 'installed-build' } };
const getSummary = vi.fn(async () => summary);
beforeEach(() => { getSummary.mockReset(); getSummary.mockResolvedValue(summary); vi.stubGlobal('window', { electronAPI: { selectDirectory: async () => null, tool: { verifyInstallation: getSummary } } }); });
it('validates the unsaved candidate through main without persisting settings', async () => {
  expect(await validateRdcInstallation(cli)).toBe(summary); expect(getSummary).toHaveBeenCalledWith(cli);
});
it('propagates validation failure without returning success', async () => {
  getSummary.mockRejectedValueOnce(new Error('bad catalog'));
  await expect(validateRdcInstallation(cli)).rejects.toThrow('bad catalog');
});
it('keeps cancellation empty without verification', async () => {
  expect(await selectRdcInstallation()).toBeNull(); expect(getSummary).not.toHaveBeenCalled();
});
