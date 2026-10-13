#!/usr/bin/env node
/**
 * Provider-key gate.
 *
 * Scans the tracked worktree and commits introduced after the resolved base.
 * Commits already reachable from that base are left alone, so known history
 * does not fail the gate before it is rewritten.
 *
 * Base resolution matches check-git-diff:
 *   RDC_DIFF_BASE / GITHUB_BASE_SHA / GITHUB_EVENT_BEFORE
 *   all-zero or unresolvable → HEAD~1..HEAD
 *   no parent → worktree and index only
 *
 * Findings never include the matched literal.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ZERO_SHA = /^0{7,40}$/;

/** @type {{ name: string, source: string, grep: string }[]} */
export const SECRET_PATTERNS = [
  { name: 'xai', source: 'xai-[A-Za-z0-9]{20,}', grep: 'xai-[A-Za-z0-9]{20,}' },
  { name: 'openrouter', source: 'sk-or-v1-[A-Za-z0-9]{20,}', grep: 'sk-or-v1-[A-Za-z0-9]{20,}' },
  { name: 'kimi', source: 'sk-kimi-[A-Za-z0-9]{20,}', grep: 'sk-kimi-[A-Za-z0-9]{20,}' },
  { name: 'google-ai-studio', source: 'AIzaSy[0-9A-Za-z]{30,}', grep: 'AIzaSy[0-9A-Za-z]{30,}' },
  { name: 'deepseek', source: 'sk-[0-9a-f]{32}(?![0-9a-f])', grep: 'sk-[0-9a-f]{32}' },
];

export const ALLOWED_TOKENS = new Set([
  'sk-test',
  'sk-custom',
  'sk-or-fixture',
  'secret',
]);

const compiled = SECRET_PATTERNS.map((pattern) => ({
  name: pattern.name,
  re: new RegExp(pattern.source, 'g'),
}));

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
    maxBuffer: 64 * 1024 * 1024,
  });
}

export function redactSecrets(text) {
  let redacted = String(text ?? '');
  for (const pattern of compiled) {
    pattern.re.lastIndex = 0;
    redacted = redacted.replace(pattern.re, `[${pattern.name}]`);
  }
  return redacted;
}

export function findSecretsInText(text) {
  const findings = [];
  const lines = String(text ?? '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const pattern of compiled) {
      pattern.re.lastIndex = 0;
      let matched = false;
      for (const match of line.matchAll(pattern.re)) {
        if (ALLOWED_TOKENS.has(match[0])) continue;
        matched = true;
        break;
      }
      if (matched) findings.push({ line: index + 1, pattern: pattern.name });
    }
  }
  return findings;
}

export function scanFile(filePath) {
  const text = readFileSync(filePath, 'utf8');
  return findSecretsInText(text).map((finding) => ({
    path: filePath,
    line: finding.line,
    pattern: finding.pattern,
  }));
}

export function findSecretsInDiff(diffText) {
  const findings = [];
  let file = '';
  let newLine = 0;
  for (const line of String(diffText ?? '').split('\n')) {
    if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('--- ')
      || line.startsWith('new file') || line.startsWith('deleted file')
      || line.startsWith('similarity ') || line.startsWith('rename ')
      || line.startsWith('old mode') || line.startsWith('new mode')
      || line.startsWith('Binary file')) {
      continue;
    }
    if (line.startsWith('+++ ')) {
      const name = line.slice(4).trim();
      file = name.startsWith('b/') ? name.slice(2) : name;
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (line.startsWith('+')) {
      for (const finding of findSecretsInText(line.slice(1))) {
        findings.push({ path: file, line: newLine, pattern: finding.pattern });
      }
      newLine += 1;
      continue;
    }
    if (line.startsWith('-') || line.startsWith('\\')) continue;
    newLine += 1;
  }
  return findings;
}

function isResolvableCommit(cwd, sha) {
  const trimmed = String(sha ?? '').trim();
  if (!trimmed || isZeroSha(trimmed)) return false;
  return git(cwd, ['rev-parse', '--verify', `${trimmed}^{commit}`]).status === 0;
}

export function resolveSecretScanRange({ cwd = process.cwd(), env = process.env } = {}) {
  const candidate = String(
    env.RDC_DIFF_BASE || env.GITHUB_BASE_SHA || env.GITHUB_EVENT_BEFORE || '',
  ).trim();
  if (isResolvableCommit(cwd, candidate)) {
    return { mode: 'base', base: candidate, head: 'HEAD' };
  }
  const parent = git(cwd, ['rev-parse', '--verify', 'HEAD~1']);
  if (parent.status === 0) {
    return { mode: 'parent', base: parent.stdout.trim(), head: 'HEAD' };
  }
  return { mode: 'worktree', base: '', head: 'HEAD' };
}

function grepArguments(extra = []) {
  const args = ['grep', '-I', '-n', '-E', ...extra];
  for (const pattern of SECRET_PATTERNS) args.push('-e', pattern.grep);
  return args;
}

function findingsFromGrep(stdout) {
  const findings = [];
  for (const raw of String(stdout ?? '').split('\n')) {
    if (!raw) continue;
    const parsed = /^(.*?):(\d+):(.*)$/.exec(raw);
    if (!parsed) continue;
    for (const finding of findSecretsInText(parsed[3])) {
      findings.push({
        path: parsed[1],
        line: Number(parsed[2]),
        pattern: finding.pattern,
      });
    }
  }
  return findings;
}

function gitText(result, label) {
  if (result.error) {
    throw new Error(`${label} failed: ${result.error.message}`);
  }
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`${label} failed: ${redactSecrets(result.stderr || '').trim()}`);
  }
  return result.stdout ?? '';
}

function dedupe(findings) {
  const seen = new Set();
  return findings.filter((finding) => {
    const key = `${finding.path}:${finding.line}:${finding.pattern}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function runSecretCheck({ cwd = process.cwd(), env = process.env } = {}) {
  const range = resolveSecretScanRange({ cwd, env });
  const findings = [];

  const worktree = git(cwd, grepArguments());
  findings.push(...findingsFromGrep(gitText(worktree, 'worktree grep')));

  const cached = git(cwd, ['diff', '--cached', '--unified=0', '--no-color']);
  if (cached.status !== 0 || cached.error) {
    throw new Error(`index diff failed: ${redactSecrets(cached.stderr || cached.error?.message || '').trim()}`);
  }
  findings.push(...findSecretsInDiff(cached.stdout));

  if (range.base) {
    const list = git(cwd, ['rev-list', '--reverse', `${range.base}..${range.head}`]);
    if (list.status !== 0 || list.error) {
      throw new Error(`rev-list failed: ${redactSecrets(list.stderr || list.error?.message || '').trim()}`);
    }
    for (const rev of (list.stdout ?? '').split('\n').filter(Boolean)) {
      const message = git(cwd, ['log', '-1', '--format=%B', rev]);
      if (message.status !== 0 || message.error) {
        throw new Error(`commit message read failed: ${redactSecrets(message.stderr || '').trim()}`);
      }
      for (const finding of findSecretsInText(message.stdout)) {
        findings.push({ path: `${rev}:message`, line: finding.line, pattern: finding.pattern });
      }
      const patch = git(cwd, ['show', '--format=', '--unified=0', '-m', '--no-color', rev]);
      if (patch.status !== 0 || patch.error) {
        throw new Error(`commit diff failed: ${redactSecrets(patch.stderr || patch.error?.message || '').trim()}`);
      }
      for (const finding of findSecretsInDiff(patch.stdout)) {
        findings.push({ path: `${rev}:${finding.path}`, line: finding.line, pattern: finding.pattern });
      }
    }
  }

  return {
    ok: findings.length === 0,
    findings: dedupe(findings),
    ...range,
  };
}

if (isDirectInvocation(import.meta.url)) {
  try {
    const result = runSecretCheck();
    if (!result.ok) {
      console.error(`[secrets] ${result.findings.length} provider key literal(s) (mode=${result.mode})`);
      for (const finding of result.findings) {
        console.error(`[secrets] ${finding.path}:${finding.line} ${finding.pattern}`);
      }
      process.exit(1);
    }
    console.log(`[secrets] OK mode=${result.mode}`);
  } catch (error) {
    console.error(`[secrets] ${redactSecrets(error instanceof Error ? error.message : String(error))}`);
    process.exit(1);
  }
}
