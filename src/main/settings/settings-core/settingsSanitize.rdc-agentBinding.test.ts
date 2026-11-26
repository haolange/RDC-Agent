import path from 'node:path';
import { expect, it } from 'vitest';
import { DEFAULT_TOOLING } from '@shared/constants/appSettingsDefaults';
import { rdcInstallationFiles } from '../../platform/rdcLayout';
import { createDefaultSettingsFile } from './settingsDefaults';
import { parseSettingsFile } from './settingsFileSchema';
import { sanitizeRdcCliInvokerSettings } from './settingsSanitize';

it('loads old invalid settings visibly but rejects saving them', () => {
  const saved = {
    enabled: true,
    command: 'C:/Tools/rdc.bat',
    argsPrefix: ['--non-interactive'],
    env: {},
    workingDirectory: '',
    timeoutMs: 30000,
  };
  const stored = parseSettingsFile({ ...createDefaultSettingsFile(), tooling: { ...DEFAULT_TOOLING, rdcCli: saved } });
  expect(stored.tooling.rdcCli).toEqual(saved);
  expect(() => sanitizeRdcCliInvokerSettings(saved, saved, true)).toThrow('RDC_BAT_REJECTED');
  const installed = rdcInstallationFiles(path.resolve('/Tools'));
  const valid = { ...saved, command: installed.python, argsPrefix: [installed.entry] };
  expect(sanitizeRdcCliInvokerSettings(valid, saved, true)).toEqual(valid);
});
