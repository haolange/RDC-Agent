import { expect, it } from 'vitest';
import { sanitizeRdxCliInvokerSettings, sanitizeToolingSettings } from './settingsSanitize';

it('loads old invalid settings visibly but rejects saving them', () => {
  const saved = { enabled: true, command: 'C:/Tools/rdx.bat', argsPrefix: ['--non-interactive'], env: {}, workingDirectory: '', timeoutMs: 30000 };
  expect(sanitizeToolingSettings({ rdxCli: saved }).rdxCli).toEqual(saved);
  expect(() => sanitizeRdxCliInvokerSettings(saved, saved, true)).toThrow('RDX_BAT_REJECTED');
  const valid = { ...saved, command: 'C:/Tools/binaries/windows/x64/python/python.exe', argsPrefix: ['C:/Tools/cli/run_cli.py'] };
  expect(sanitizeRdxCliInvokerSettings(valid, saved, true)).toEqual(valid);
});
