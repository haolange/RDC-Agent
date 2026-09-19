import { beforeEach, expect, it, vi } from 'vitest';
import { validateRdxInstallation } from './rdxInstallation';
const cli = { enabled: true, command: 'C:/Tools/binaries/windows/x64/python/python.exe', argsPrefix: ['C:/Tools/cli/run_cli.py'], workingDirectory: '', env: {}, timeoutMs: 30000 };
const summary = { cli: { available: true }, runtime: { version: 'installed-build' } };
const getSummary = vi.fn(async () => summary);
beforeEach(() => { getSummary.mockClear(); vi.stubGlobal('window', { electronAPI: { settings: { get: async () => ({ tooling: { rdxCli: cli } }) }, tool: { getRuntimeSummary: getSummary } } }); });
it('validates the saved installation through the main process', async () => {
  expect(await validateRdxInstallation(cli)).toBe(summary); expect(getSummary).toHaveBeenCalledTimes(1);
});
it('does not label an unsaved executable as verified', async () => {
  expect(await validateRdxInstallation({ ...cli, command: 'C:/Other/binaries/windows/x64/python/python.exe', argsPrefix: ['C:/Other/cli/run_cli.py'] })).toBeNull(); expect(getSummary).not.toHaveBeenCalled();
});
