import { expect, it } from 'vitest';
import { sanitizeRdcCliInvokerSettings, sanitizeToolingSettings } from './settingsSanitize';

it('loads old invalid settings visibly but rejects saving them', () => {
  const saved = { enabled: true, command: 'C:/Tools/rdc.bat', argsPrefix: ['--non-interactive'], env: {}, workingDirectory: '', timeoutMs: 30000 };
  expect(sanitizeToolingSettings({ rdcCli: saved }).rdcCli).toEqual(saved);
  expect(() => sanitizeRdcCliInvokerSettings(saved, saved, true)).toThrow('RDC_BAT_REJECTED');
  const valid = { ...saved, command: 'C:/Tools/binaries/windows/x64/python/python.exe', argsPrefix: ['C:/Tools/cli/run_cli.py'] };
  expect(sanitizeRdcCliInvokerSettings(valid, saved, true)).toEqual(valid);
});
