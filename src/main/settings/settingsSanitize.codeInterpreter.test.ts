import { describe, expect, it } from 'vitest';
import { sanitizeAgentShellSettings, sanitizeCodeInterpreterSettings, sanitizeToolingSettings } from './settingsSanitize';

describe('sanitizeCodeInterpreterSettings', () => {
  it('fills defaults when the field is missing', () => {
    const tooling = sanitizeToolingSettings({ rdcCli: {} });
    expect(tooling.codeInterpreter).toEqual({
      enabled: false,
      command: '',
      argsPrefix: [],
      timeoutMs: 60000,
      env: {},
      artifactsEnabled: true,
    });
    expect(tooling.shell).toEqual({ executable: '' });
  });

  it('keeps only the executable field for tooling.shell', () => {
    expect(sanitizeAgentShellSettings({
      executable: '  C:\\\\pwsh.exe  ',
      env: { TOKEN: 'secret' },
    })).toEqual({ executable: 'C:\\\\pwsh.exe' });
  });

  it('does not accept a project-shaped extra shell payload beyond executable', () => {
    const tooling = sanitizeToolingSettings({
      rdcCli: {},
      shell: { executable: '/bin/bash', env: { HOME: '/tmp' }, cwd: '/tmp' },
    });
    expect(tooling.shell).toEqual({ executable: '/bin/bash' });
    expect(tooling.shell).not.toHaveProperty('env');
    expect(tooling.shell).not.toHaveProperty('cwd');
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
