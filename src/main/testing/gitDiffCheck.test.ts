import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// Scripts live outside tsconfig include; the .mjs is the CI whitespace gate.
// @ts-expect-error -- untyped ESM helper
import { isZeroSha, resolveDiffCheckArgs, runGitDiffCheck } from '../../../scripts/check-git-diff.mjs';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function git(cwd: string, args: string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return (result.stdout || '').trim();
}

function initRepo() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'rdc-git-diff-'));
  roots.push(root);
  git(root, ['init']);
  git(root, ['config', 'user.email', 'git-diff-check@example.com']);
  git(root, ['config', 'user.name', 'Git Diff Check']);
  git(root, ['config', 'core.autocrlf', 'false']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  return root;
}

function commitFile(cwd: string, fileName: string, contents: string, message: string) {
  writeFileSync(path.join(cwd, fileName), contents, 'utf8');
  git(cwd, ['add', fileName]);
  git(cwd, ['commit', '--no-gpg-sign', '-m', message]);
}

describe('git diff --check base resolution', () => {
  it('treats all-zero SHAs as unusable', () => {
    expect(isZeroSha('0000000')).toBe(true);
    expect(isZeroSha('0000000000000000000000000000000000000000')).toBe(true);
    expect(isZeroSha('abc1234')).toBe(false);
    expect(isZeroSha('')).toBe(false);
  });

  it('falls back to --cached on a first commit when the base is missing', () => {
    const root = initRepo();
    commitFile(root, 'readme.txt', 'ok\n', 'first');
    const resolved = resolveDiffCheckArgs({ cwd: root, env: {} });
    expect(resolved.mode).toBe('cached');
    expect(resolved.args).toEqual(['diff', '--cached', '--check']);
    const result = runGitDiffCheck({ cwd: root, env: {} });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(0);
  });

  it('falls back to --cached for an all-zero base on a first commit', () => {
    const root = initRepo();
    commitFile(root, 'readme.txt', 'ok\n', 'first');
    const resolved = resolveDiffCheckArgs({
      cwd: root,
      env: { RDC_DIFF_BASE: '0000000000000000000000000000000000000000' },
    });
    expect(resolved.mode).toBe('cached');
  });

  it('falls back to HEAD~1..HEAD when the base SHA is invalid', () => {
    const root = initRepo();
    commitFile(root, 'a.txt', 'one\n', 'first');
    commitFile(root, 'b.txt', 'two\n', 'second');
    const resolved = resolveDiffCheckArgs({
      cwd: root,
      env: { RDC_DIFF_BASE: '0123456789abcdef0123456789abcdef01234567' },
    });
    expect(resolved.mode).toBe('parent');
    expect(resolved.args).toEqual(['diff', '--check', 'HEAD~1..HEAD']);
  });

  it('uses RDC_DIFF_BASE when it resolves to a commit', () => {
    const root = initRepo();
    commitFile(root, 'a.txt', 'one\n', 'first');
    const base = git(root, ['rev-parse', 'HEAD']);
    commitFile(root, 'b.txt', 'two\n', 'second');
    const resolved = resolveDiffCheckArgs({
      cwd: root,
      env: { RDC_DIFF_BASE: base },
    });
    expect(resolved.mode).toBe('base');
    expect(resolved.args).toEqual(['diff', '--check', `${base}..HEAD`]);
    const result = runGitDiffCheck({ cwd: root, env: { RDC_DIFF_BASE: base } });
    expect(result.ok).toBe(true);
  });

  it('fails when the resolved range introduces trailing whitespace', () => {
    const root = initRepo();
    commitFile(root, 'a.txt', 'one\n', 'first');
    const base = git(root, ['rev-parse', 'HEAD']);
    commitFile(root, 'b.txt', 'two \n', 'second');
    const result = runGitDiffCheck({ cwd: root, env: { RDC_DIFF_BASE: base } });
    expect(result.ok).toBe(false);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/trailing whitespace|b\.txt/i);
  });
});
