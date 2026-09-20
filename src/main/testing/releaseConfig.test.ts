import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../..');
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };

function check(channel: string, ref = '') {
  const result = spawnSync(process.execPath, ['scripts/check-release-config.mjs'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      RDC_AGENT_RELEASE_CHANNEL: channel,
      GITHUB_REF: ref,
      WIN_CSC_LINK: '', WIN_CSC_KEY_PASSWORD: '', CSC_LINK: '', CSC_KEY_PASSWORD: '',
    },
  });
  if (result.error) throw result.error;
  return result;
}

describe('release signing boundary', () => {
  it('allows unsigned local packs', () => expect(check('').status).toBe(0));
  it('requires signing for the stable release channel', () => {
    const result = check('release');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Release channel requires');
  });
  it('does not infer an unsigned exemption from a prerelease tag', () => {
    expect(check('', `refs/tags/v${version}`).status).toBe(1);
  });
  it('requires an explicit prerelease version and matching tag', () => {
    expect(check('prerelease', `refs/tags/v${version}`).status).toBe(version.includes('-') ? 0 : 1);
  });
  it('rejects stable or mismatched tags in the unsigned channel', () => {
    for (const ref of ['refs/tags/v99.0.0', 'refs/tags/v99.0.0-rc.1']) {
      const result = check('prerelease', ref);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Unsigned prerelease requires');
    }
  });
});
