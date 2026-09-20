import path from 'node:path';
import { describe, expect, it } from 'vitest';
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
