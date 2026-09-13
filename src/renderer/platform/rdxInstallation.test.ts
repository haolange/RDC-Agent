import { beforeEach, expect, it, vi } from 'vitest';
import { validateRdxInstallation } from './rdxInstallation';
const cli = { enabled: true, command: 'rdx', argsPrefix: [], workingDirectory: '', env: {}, timeoutMs: 30000 };
const summary = { cli: { available: true }, runtime: { version: 'installed-build' } };
const getSummary = vi.fn(async () => summary);
beforeEach(() => { getSummary.mockClear(); vi.stubGlobal('window', { electronAPI: { settings: { get: async () => ({ tooling: { rdxCli: cli } }) }, tool: { getRuntimeSummary: getSummary } } }); });
it('validates the saved installation through the main process', async () => {
  expect(await validateRdxInstallation(cli)).toBe(summary); expect(getSummary).toHaveBeenCalledTimes(1);
});
it('does not label an unsaved executable as verified', async () => {
  expect(await validateRdxInstallation({ ...cli, command: 'different' })).toBeNull(); expect(getSummary).not.toHaveBeenCalled();
});
