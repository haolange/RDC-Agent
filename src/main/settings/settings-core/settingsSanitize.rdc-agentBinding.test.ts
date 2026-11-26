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
    noProgressTimeoutMs: 30_000,
  };
  const stored = parseSettingsFile({ ...createDefaultSettingsFile(), tooling: { ...DEFAULT_TOOLING, rdcCli: saved } });
  expect(stored.tooling.rdcCli).toEqual(saved);
  expect(() => sanitizeRdcCliInvokerSettings(saved, saved, true)).toThrow('RDC_BAT_REJECTED');
  const installed = rdcInstallationFiles(path.resolve('/Tools'));
  const valid = { ...saved, command: installed.python, argsPrefix: [installed.entry] };
  expect(sanitizeRdcCliInvokerSettings(valid, saved, true)).toEqual(valid);
});

it.each([
  ['the old fixed timeout field', { timeoutMs: 120_000 }],
  ['a patience under the published minimum', { noProgressTimeoutMs: 1_000 }],
  ['a patience over the published maximum', { noProgressTimeoutMs: 7_200_000 }],
])('rejects a settings file carrying %s', (_name, patch) => {
  const rdcCli = { ...DEFAULT_TOOLING.rdcCli, ...patch };
  if ('timeoutMs' in patch) delete (rdcCli as Partial<typeof rdcCli>).noProgressTimeoutMs;
  expect(() =>
    parseSettingsFile({ ...createDefaultSettingsFile(), tooling: { ...DEFAULT_TOOLING, rdcCli } }),
  ).toThrow();
});

it('saves an in-range patience as given instead of clamping it', () => {
  const current = DEFAULT_TOOLING.rdcCli;
  expect(sanitizeRdcCliInvokerSettings({ ...current, noProgressTimeoutMs: 45_000 }, current).noProgressTimeoutMs).toBe(
    45_000,
  );
  expect(() => sanitizeRdcCliInvokerSettings({ ...current, noProgressTimeoutMs: 600_001.5 }, current)).toThrow(
    'IPC_VALIDATION_ERROR',
  );
  expect(() => sanitizeRdcCliInvokerSettings({ ...current, noProgressTimeoutMs: 10_000 }, current)).toThrow(
    'IPC_VALIDATION_ERROR',
  );
});
