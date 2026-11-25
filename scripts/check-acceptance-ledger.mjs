#!/usr/bin/env node
/**
 * Every dated ledger section (`## YYYY-MM-DD：…`) is bound to evidence: it names the commit it verified
 * (`- 提交：\`<sha>\`` reachable from HEAD) and its evidence (`- 证据：` with a CI run URL, an artifact path in
 * backticks, or `本地：` and the command that ran). The handover baselines kept under a non-dated heading are
 * quoted history and are not re-validated.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER_REL = 'docs/product/acceptance-ledger.md';
const SECTION_RE = /^## (\d{4}-\d{2}-\d{2})：/;
const COMMIT_RE = /^\s*-\s*提交[:：].*?`([0-9a-f]{7,40})`/g;
const EVIDENCE_RE = /https:\/\/github\.com\/[^\s)]+\/actions\/runs\/\d+|`[^`]+\.(?:json|png|log|txt|md|zip)`|本地[:：]\s*`[^`]+`/;

const git = (args) => spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
const failures = [];

const listed = git(['rev-list', 'HEAD']);
if (listed.status !== 0) {
  console.error(`[acceptance-ledger] git rev-list HEAD failed: ${(listed.stderr || listed.stdout || '').trim()}`);
  process.exit(1);
}
const ancestors = new Set(listed.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
const resolveCommit = (sha) => {
  const result = git(['rev-parse', '--verify', `${sha}^{commit}`]);
  return result.status === 0 ? result.stdout.trim() : null;
};

const lines = readFileSync(path.join(repoRoot, LEDGER_REL), 'utf8').split(/\r?\n/);
const headings = lines.flatMap((line, index) => (line.startsWith('## ') ? [{ index, dated: SECTION_RE.test(line), title: line }] : []));
headings.forEach((heading, position) => {
  if (!heading.dated) return;
  const body = lines.slice(heading.index + 1, headings[position + 1]?.index ?? lines.length);
  const where = `${LEDGER_REL}:${heading.index + 1}`;
  const commits = body.flatMap((line) => [...line.matchAll(COMMIT_RE)].map((match) => match[1]));
  if (commits.length === 0) failures.push(`${where} "${heading.title}" names no commit (- 提交：\`<sha>\`).`);
  for (const sha of commits) {
    const resolved = resolveCommit(sha);
    if (!resolved || !ancestors.has(resolved)) failures.push(`${where} commit ${sha} is not in git rev-list HEAD.`);
  }
  if (!body.some((line) => /^\s*-\s*证据[:：]/.test(line) && EVIDENCE_RE.test(line))) {
    failures.push(`${where} "${heading.title}" has no evidence line with a CI run URL, an artifact path or 本地：\`<command>\`.`);
  }
});

for (const failure of failures) console.error(`[acceptance-ledger] ${failure}`);
if (failures.length) process.exit(1);
console.log(`[acceptance-ledger] OK (${headings.filter((heading) => heading.dated).length} dated sections)`);
