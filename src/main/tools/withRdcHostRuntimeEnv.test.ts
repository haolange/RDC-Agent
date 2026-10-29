import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { appPathService } from '../runtime/AppPathService';
import { RDC_INTERMEDIATE_ROOT_ENV, hostRdcIntermediateRoot, withRdcHostRuntimeEnv } from './withRdcHostRuntimeEnv';

const cli = {
  enabled: true,
  command: 'rdc',
  argsPrefix: [],
  workingDirectory: '',
  env: {} as Record<string, string>,
  timeoutMs: 30_000,
};

describe('withRdcHostRuntimeEnv', () => {
  it('binds native dependencies to the selected installation instead of an inherited root', () => {
    vi.stubEnv('RDC_TOOL_ROOT', 'C:\\other-installation');
    const root = path.resolve('selected-tools');
    try {
      const result = withRdcHostRuntimeEnv({ ...cli, command: path.join(root, 'binaries/windows/x64/python/python.exe'), argsPrefix: [path.join(root, 'cli/run_cli.py')], workingDirectory: root });
      expect(result.env.RDC_TOOL_ROOT).toBe(root);
    } finally { vi.unstubAllEnvs(); }
  });
  it('injects the user-scope intermediate root when Settings env omits it', () => {
    const resolved = withRdcHostRuntimeEnv(cli);
    const expected = appPathService.getUserRdcPaths().rdcIntermediateRoot;
    expect(hostRdcIntermediateRoot()).toBe(expected);
    expect(path.basename(expected)).toBe('rdc-tool-intermediate');
    expect(resolved.env[RDC_INTERMEDIATE_ROOT_ENV]).toBe(expected);
    expect(cli.env).toEqual({});
  });

  it('keeps an explicit Settings override', () => {
    const override = path.join('isolated', 'task-root');
    const resolved = withRdcHostRuntimeEnv({
      ...cli,
      env: { [RDC_INTERMEDIATE_ROOT_ENV]: override },
    });
    expect(resolved.env[RDC_INTERMEDIATE_ROOT_ENV]).toBe(override);
  });
});
