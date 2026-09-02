import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// Scripts live outside tsconfig include; the .mjs is the shared launcher helper.
// @ts-expect-error -- untyped ESM helper
import { REQUIRED_PNPM, pnpmCandidates, resolvePnpm } from '../../../scripts/pnpm-resolver.mjs';

describe('pnpm resolver', () => {
  it('keeps REQUIRED_PNPM at 11.7.0', () => {
    expect(REQUIRED_PNPM).toBe('11.7.0');
  });

  it('places corepack after adjacent node_modules pnpm and before PATH pnpm', () => {
    const execPath = path.join(os.tmpdir(), 'node-runtime', 'bin', 'node');
    const adjacentPnpm = path.resolve(path.dirname(execPath), '..', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs');
    const candidates = pnpmCandidates({
      platform: 'linux',
      execPath,
      homedir: path.join(os.tmpdir(), 'no-codex-cache'),
      existsSync: (candidate: string) => path.resolve(candidate) === adjacentPnpm,
    });
    expect(candidates.map((candidate: { label: string }) => candidate.label)).toEqual([
      adjacentPnpm,
      'corepack pnpm',
      'pnpm',
    ]);
    expect(candidates[1]).toMatchObject({
      command: 'corepack',
      prefix: ['pnpm'],
    });
  });

  it('uses corepack.cmd pnpm on Windows before PATH pnpm.cmd', () => {
    const candidates = pnpmCandidates({
      platform: 'win32',
      execPath: 'C:\\nodejs\\node.exe',
      homedir: 'C:\\Users\\nobody',
      existsSync: () => false,
      comSpec: 'C:\\Windows\\System32\\cmd.exe',
    });
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      command: 'C:\\Windows\\System32\\cmd.exe',
      prefix: ['/d', '/s', '/c', 'corepack.cmd', 'pnpm'],
      label: 'corepack.cmd pnpm',
    });
    expect(candidates[1]).toMatchObject({
      command: 'C:\\Windows\\System32\\cmd.exe',
      prefix: ['/d', '/s', '/c', 'pnpm.cmd'],
      label: 'pnpm.cmd',
    });
  });

  it('accepts only version 11.7.0 and records rejected versions', () => {
    const picked = resolvePnpm({
      candidates: [
        { command: 'wrong', prefix: [], label: 'path pnpm', shell: false },
        { command: 'corepack', prefix: ['pnpm'], label: 'corepack pnpm', shell: false },
      ],
      runSync: (command: string) => (
        command === 'corepack'
          ? { status: 0, output: '11.7.0' }
          : { status: 0, output: '11.6.2' }
      ),
      fail: (message: string) => {
        throw new Error(message);
      },
    });
    expect(picked.label).toBe('corepack pnpm');

    expect(() => resolvePnpm({
      candidates: [{ command: 'path', prefix: [], label: 'pnpm', shell: false }],
      runSync: () => ({ status: 0, output: '11.6.2' }),
      fail: (message: string) => {
        throw new Error(message);
      },
    })).toThrow(/pnpm 11\.7\.0 is required\. Checked: pnpm=11\.6\.2/);
  });
});
