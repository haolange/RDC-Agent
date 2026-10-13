import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// Scripts live outside tsconfig include; the .mjs is the provider-key gate.
// @ts-expect-error -- untyped ESM helper
import { findSecretsInDiff, findSecretsInText, isZeroSha, resolveSecretScanRange, runSecretCheck, scanFile } from '../../../scripts/check-secrets.mjs';

type SecretFinding = { path?: string; line: number; pattern: string };

function patternNames(findings: SecretFinding[]): string[] {
  return findings.map((finding) => finding.pattern);
}

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
  const root = mkdtempSync(path.join(os.tmpdir(), 'rdc-secret-scan-'));
  roots.push(root);
  git(root, ['init']);
  git(root, ['config', 'user.email', 'secret-scan@example.com']);
  git(root, ['config', 'user.name', 'Secret Scan']);
  git(root, ['config', 'core.autocrlf', 'false']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  return root;
}

function commitFile(cwd: string, fileName: string, contents: string, message: string) {
  writeFileSync(path.join(cwd, fileName), contents, 'utf8');
  git(cwd, ['add', fileName]);
  git(cwd, ['commit', '--no-gpg-sign', '-m', message]);
}

function fakeTokens() {
  return {
    xai: `xai-${'A'.repeat(24)}`,
    openrouter: `sk-or-v1-${'ab'.repeat(12)}`,
    kimi: `sk-kimi-${'c'.repeat(24)}`,
    google: `AIzaSy${'D'.repeat(33)}`,
    deepseek: `sk-${'0123456789abcdef'.repeat(2)}`,
  };
}

const FIXTURES = [
  "apiKey: 'sk-test'",
  "apiKey: 'sk-custom'",
  "apiKey: 'sk-or-fixture'",
  "apiKey: 'secret'",
].join('\n');

describe('provider key literal gate', () => {
  it('treats all-zero SHAs as unusable', () => {
    expect(isZeroSha('0000000')).toBe(true);
    expect(isZeroSha('0000000000000000000000000000000000000000')).toBe(true);
    expect(isZeroSha('abc1234')).toBe(false);
    expect(isZeroSha('')).toBe(false);
  });

  it('ignores fixture placeholders and flags each provider shape', () => {
    expect(findSecretsInText(FIXTURES)).toEqual([]);
    expect(findSecretsInText('xai-responses-function-calling-output')).toEqual([]);
    const tokens = fakeTokens();
    expect(patternNames(findSecretsInText(tokens.xai))).toEqual(['xai']);
    expect(patternNames(findSecretsInText(tokens.openrouter))).toEqual(['openrouter']);
    expect(patternNames(findSecretsInText(tokens.kimi))).toEqual(['kimi']);
    expect(patternNames(findSecretsInText(tokens.google))).toEqual(['google-ai-studio']);
    expect(patternNames(findSecretsInText(tokens.deepseek))).toEqual(['deepseek']);
    expect(findSecretsInText(`sk-${'ab'.repeat(20)}`)).toEqual([]);
  });

  it('flags a temporary file and ignores deletions in a diff', () => {
    const root = initRepo();
    const file = path.join(root, 'leak.txt');
    const token = fakeTokens().xai;
    writeFileSync(file, `apiKey: '${token}'\n`, 'utf8');
    const findings = scanFile(file);
    expect(patternNames(findings)).toEqual(['xai']);
    expect(JSON.stringify(findings)).not.toContain(token);

    const added = findSecretsInDiff(`+++ b/leak.txt\n@@ -0,0 +1 @@\n+${token}\n`);
    expect(added).toEqual([{ path: 'leak.txt', line: 1, pattern: 'xai' }]);
    expect(findSecretsInDiff(`+++ b/leak.txt\n@@ -1 +0,0 @@\n-${token}\n`)).toEqual([]);
  });

  it('does not report a key that exists only before the base', () => {
    const root = initRepo();
    commitFile(root, 'a.txt', `${fakeTokens().deepseek}\n`, 'leak');
    commitFile(root, 'a.txt', 'clean\n', 'remove');
    const result = runSecretCheck({ cwd: root, env: {} });
    expect(result.mode).toBe('parent');
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('reports a key introduced after the base, including one later removed', () => {
    const root = initRepo();
    commitFile(root, 'a.txt', 'clean\n', 'base');
    const base = git(root, ['rev-parse', 'HEAD']);
    commitFile(root, 'a.txt', `${fakeTokens().openrouter}\n`, 'introduce');
    commitFile(root, 'a.txt', 'clean again\n', 'remove');
    const result = runSecretCheck({ cwd: root, env: { RDC_DIFF_BASE: base } });
    expect(result.mode).toBe('base');
    expect(result.ok).toBe(false);
    expect(patternNames(result.findings)).toContain('openrouter');
    expect(JSON.stringify(result.findings)).not.toContain(fakeTokens().openrouter);
  });

  it('reports an uncommitted edit to a tracked file', () => {
    const root = initRepo();
    commitFile(root, 'a.txt', 'clean\n', 'base');
    writeFileSync(path.join(root, 'a.txt'), `${fakeTokens().kimi}\n`, 'utf8');
    const result = runSecretCheck({ cwd: root, env: {} });
    expect(result.ok).toBe(false);
    expect(patternNames(result.findings)).toContain('kimi');
  });

  it('accepts tracked fixture placeholders', () => {
    const root = initRepo();
    commitFile(root, 'a.txt', `${FIXTURES}\n`, 'fixtures');
    const result = runSecretCheck({ cwd: root, env: {} });
    expect(result.mode).toBe('worktree');
    expect(result.ok).toBe(true);
  });

  it('falls back to the parent range for an all-zero base', () => {
    const root = initRepo();
    commitFile(root, 'a.txt', 'one\n', 'first');
    commitFile(root, 'b.txt', 'two\n', 'second');
    const resolved = resolveSecretScanRange({
      cwd: root,
      env: { RDC_DIFF_BASE: '0000000000000000000000000000000000000000' },
    });
    expect(resolved.mode).toBe('parent');
  });
});
