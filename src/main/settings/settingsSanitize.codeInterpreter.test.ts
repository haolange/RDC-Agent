import { describe, expect, it } from 'vitest';
import { sanitizeCodeInterpreterSettings, sanitizeToolingSettings } from './settingsSanitize';

describe('sanitizeCodeInterpreterSettings', () => {
  it('fills defaults when the field is missing', () => {
    const tooling = sanitizeToolingSettings({ rdxCli: {}, rdxActions: {} });
    expect(tooling.codeInterpreter).toEqual({
      enabled: false,
      command: '',
      argsPrefix: [],
      timeoutMs: 60000,
      env: {},
      artifactsEnabled: true,
    });
  });

  it('clamps timeout and keeps explicit enablement', () => {
    expect(sanitizeCodeInterpreterSettings({
      enabled: true,
      command: '  py  ',
      argsPrefix: ['-X', 'utf8'],
      timeoutMs: 12,
      env: { PYTHONUNBUFFERED: '1' },
      artifactsEnabled: false,
    })).toEqual({
      enabled: true,
      command: 'py',
      argsPrefix: ['-X', 'utf8'],
      timeoutMs: 1000,
      env: { PYTHONUNBUFFERED: '1' },
      artifactsEnabled: false,
    });
  });
});
