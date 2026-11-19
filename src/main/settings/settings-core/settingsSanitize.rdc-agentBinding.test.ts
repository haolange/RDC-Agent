import path from 'node:path';
import { expect, it } from 'vitest';
import { rdcInstallationFiles } from '../../platform/rdcLayout';
import { sanitizeRdcCliInvokerSettings, sanitizeToolingSettings } from './settingsSanitize';

it('loads old invalid settings visibly but rejects saving them', () => {
  const saved = { enabled: true, command: 'C:/Tools/rdc.bat', argsPrefix: ['--non-interactive'], env: {}, workingDirectory: '', timeoutMs: 30000 };
  expect(sanitizeToolingSettings({ rdcCli: saved }).rdcCli).toEqual(saved);
  expect(() => sanitizeRdcCliInvokerSettings(saved, saved, true)).toThrow('RDC_BAT_REJECTED');
  const installed = rdcInstallationFiles(path.resolve('/Tools'));
  const valid = { ...saved, command: installed.python, argsPrefix: [installed.entry] };
  expect(sanitizeRdcCliInvokerSettings(valid, saved, true)).toEqual(valid);
});
