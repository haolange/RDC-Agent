#!/usr/bin/env node
/**
 * Whitespace gate: `git diff --check` against a resolved base.
 *
 * Base resolution:
 *   RDC_DIFF_BASE / GITHUB_BASE_SHA / GITHUB_EVENT_BEFORE
 *   all-zero or unresolvable → HEAD~1..HEAD
 *   no parent (first commit) → `git diff --cached --check`
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ZERO_SHA = /^0{7,40}$/;

export function isZeroSha(value) {
  const sha = String(value ?? '').trim();
  return sha.length > 0 && ZERO_SHA.test(sha);
}

export function isDirectInvocation(metaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return path.normalize(fileURLToPath(metaUrl)) === path.normalize(path.resolve(argv1));
  } catch {
    return false;
  }
}

function git(cwd, args) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
}

function isResolvableCommit(cwd, sha) {
  const trimmed = String(sha ?? '').trim();
  if (!trimmed || isZeroSha(trimmed)) return false;
  const result = git(cwd, ['rev-parse', '--verify', `${trimmed}^{commit}`]);
  return result.status === 0;
}

export function resolveDiffCheckArgs({ cwd = process.cwd(), env = process.env } = {}) {
  const candidate = String(
    env.RDC_DIFF_BASE || env.GITHUB_BASE_SHA || env.GITHUB_EVENT_BEFORE || '',
  ).trim();

  if (isResolvableCommit(cwd, candidate)) {
    return {
      args: ['diff', '--check', `${candidate}..HEAD`],
      mode: 'base',
      base: candidate,
    };
  }

  const parent = git(cwd, ['rev-parse', '--verify', 'HEAD~1']);
  if (parent.status === 0) {
    return {
      args: ['diff', '--check', 'HEAD~1..HEAD'],
      mode: 'parent',
    };
  }

  return {
    args: ['diff', '--cached', '--check'],
    mode: 'cached',
  };
}

export function runGitDiffCheck({ cwd = process.cwd(), env = process.env } = {}) {
  const resolved = resolveDiffCheckArgs({ cwd, env });
  const result = git(cwd, resolved.args);
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const status = result.status === null ? 1 : result.status;
  const ok = status === 0;
  return {
    ok,
    status,
    stdout,
    stderr,
    ...resolved,
  };
}

if (isDirectInvocation(import.meta.url)) {
  const result = runGitDiffCheck();
  const label = `[git-diff-check] git ${result.args.join(' ')} (mode=${result.mode})`;
  if (!result.ok) {
    console.error(`${label} failed`);
    if (result.stdout.trim()) process.stderr.write(result.stdout);
    if (result.stderr.trim()) process.stderr.write(result.stderr);
    process.exit(result.status || 1);
  }
  console.log(`${label} OK`);
}
