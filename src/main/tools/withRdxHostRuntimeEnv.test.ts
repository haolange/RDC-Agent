import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { appPathService } from '../runtime/AppPathService';
import { RDX_INTERMEDIATE_ROOT_ENV, hostRdxIntermediateRoot, withRdxHostRuntimeEnv } from './withRdxHostRuntimeEnv';

const cli = {
  enabled: true,
  command: 'rdx',
  argsPrefix: [],
  workingDirectory: '',
  env: {} as Record<string, string>,
  timeoutMs: 30_000,
};

describe('withRdxHostRuntimeEnv', () => {
  it('injects the user-scope intermediate root when Settings env omits it', () => {
    const resolved = withRdxHostRuntimeEnv(cli);
    const expected = appPathService.getUserRdxPaths().rdxIntermediateRoot;
    expect(hostRdxIntermediateRoot()).toBe(expected);
    expect(path.basename(expected)).toBe('rdx-intermediate');
    expect(resolved.env[RDX_INTERMEDIATE_ROOT_ENV]).toBe(expected);
    expect(cli.env).toEqual({});
  });

  it('keeps an explicit Settings override', () => {
    const override = path.join('isolated', 'task-root');
    const resolved = withRdxHostRuntimeEnv({
      ...cli,
      env: { [RDX_INTERMEDIATE_ROOT_ENV]: override },
    });
    expect(resolved.env[RDX_INTERMEDIATE_ROOT_ENV]).toBe(override);
  });
});
