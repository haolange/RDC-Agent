#!/usr/bin/env node
/**
 * Acceptance ledger schema + verified-SHA + document phrase gate.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER_REL = 'docs/product/acceptance-ledger.md';
const REQUIRED_COLUMNS = [
  'Task',
  'Criterion',
  'Gate/Test',
  'Browser evidence ref',
  'Verdict',
  'Commit SHA',
  'Date',
];
const VERDICTS = new Set(['planned', 'verified', 'failed', 'waived-by-user']);
const EMPTY_PLACEHOLDER = /^(?:—|--|-|)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SHA_RE = /^[0-9a-f]{7,40}$/i;
const U00_U03_RE = /^U0[0-3]-/;
const SKIP_DIR_NAMES = new Set(['.cursor', '.git', 'node_modules', 'out', 'dist', 'coverage']);

const token = (...parts) => parts.join('');
const PHRASE = {
  embeddingService: token('Embedd', 'ingExecutionService'),
  semanticLane: token('Semantic', ' lane'),
  sevenLanes: token('七', ' lane'),
  askAgent: token('ask', '.agent'),
  runStillV2: token('Run 当前仍为 v', '2'),
  missingIpc: token('无该', ' IPC'),
  sixLanes: token('六', ' lane'),
  investigationRead: token('investigation', ':read'),
};

const fail = (message) => {
  console.error(`[acceptance-ledger] ${message}`);
  process.exitCode = 1;
};

const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), 'utf8');

function git(args) {
  return spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
}

function splitTableRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  const cells = trimmed.split('|').slice(1, -1).map((cell) => cell.trim());
  return cells;
}

function isSeparatorRow(cells) {
  return cells.every((cell) => /^:?-+:?$/.test(cell));
}

function parseLedgerRows(markdown) {
  const lines = markdown.split(/\r?\n/);
  let headerIndex = -1;
  let columns = null;
  const rows = [];
  for (let i = 0; i < lines.length; i += 1) {
    const cells = splitTableRow(lines[i]);
    if (!cells || cells.length === 0) continue;
    if (headerIndex < 0) {
      if (REQUIRED_COLUMNS.every((name, index) => cells[index] === name) && cells.length === REQUIRED_COLUMNS.length) {
        headerIndex = i;
        columns = cells;
      }
      continue;
    }
    if (isSeparatorRow(cells)) continue;
    if (cells.length !== REQUIRED_COLUMNS.length) {
      rows.push({ line: i + 1, cells, columnMismatch: true });
      continue;
    }
    const record = { line: i + 1 };
    for (let c = 0; c < REQUIRED_COLUMNS.length; c += 1) {
      record[REQUIRED_COLUMNS[c]] = cells[c];
    }
    rows.push(record);
  }
  return { headerIndex, columns, rows };
}

function collectMarkdownFiles() {
  const files = ['DESIGN.md', 'AGENTS.md'];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name.endsWith('.md')) {
        files.push(path.relative(repoRoot, full).replaceAll('\\', '/'));
      }
    }
  };
  walk(path.join(repoRoot, 'docs'));
  return [...new Set(files)].filter((rel) => existsSync(path.join(repoRoot, rel)));
}

function stripAllowedPendingPhrases(line) {
  return line
    .replaceAll('不再补跑', '')
    .replaceAll('不得写成尚未跑', '')
    .replaceAll('不得写成仍未跑', '')
    .replace(/不得(?:再)?把[^。\n]{0,80}写成尚未跑/g, '')
    .replace(/不得(?:再)?把[「"][^」"]{0,80}未跑[^」"]{0,80}[」"]写成[^。\n]{0,80}/g, '')
    .replace(/不得把[^。\n]{0,80}写成仍待/g, '');
}

function lineHasPendingRunClaim(line) {
  const rest = stripAllowedPendingPhrases(line);
  return /尚未跑|仍未跑|未跑/.test(rest);
}

function isClosedCapabilityContext(line) {
  return (
    /禁止恢复/.test(line)
    || /已删除/.test(line)
    || /删除/.test(line)
    || /不得把/.test(line)
    || /不得再把/.test(line)
    || /不得写成/.test(line)
    || /禁止再写/.test(line)
    || /禁止/.test(line)
    || /不是现行/.test(line)
    || /已由 U02 删除/.test(line)
    || /不再补跑/.test(line)
    || /U02-delete/.test(line)
    || /恢复 Embedding/.test(line)
    || /^\s*[-*]\s*恢复\b/.test(line)
  );
}

function isAskAgentFixtureAllow(rel, line) {
  const askAgentMd = `${PHRASE.askAgent}.md`;
  if (line.includes(PHRASE.askAgent) === false && line.includes(askAgentMd) === false) return true;
  if (rel.startsWith('scripts/')) return true;
  return isClosedCapabilityContext(line) || /fixture|historical|非法|历史非法/.test(line);
}

function scanForbiddenPhrases(files) {
  const askBoundary = new RegExp(`\\b${PHRASE.askAgent.replace('.', '\\.')}\\b`);
  const checks = [
    {
      id: PHRASE.embeddingService,
      test: (_rel, line) => line.includes(PHRASE.embeddingService) && !isClosedCapabilityContext(line),
    },
    {
      id: PHRASE.semanticLane,
      test: (_rel, line) => line.includes(PHRASE.semanticLane) && !isClosedCapabilityContext(line),
    },
    {
      id: PHRASE.sevenLanes,
      test: (_rel, line) => line.includes(PHRASE.sevenLanes) && !isClosedCapabilityContext(line),
    },
    {
      id: PHRASE.askAgent,
      test: (rel, line) => askBoundary.test(line) && !isAskAgentFixtureAllow(rel, line),
    },
    {
      id: PHRASE.runStillV2,
      test: (_rel, line) => line.includes(PHRASE.runStillV2) && !isClosedCapabilityContext(line),
    },
    {
      id: PHRASE.missingIpc,
      test: (_rel, line) => line.includes(PHRASE.missingIpc) && !isClosedCapabilityContext(line),
    },
  ];
  for (const rel of files) {
    const lines = read(rel).split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      for (const check of checks) {
        if (check.test(rel, line)) {
          fail(`${rel}:${i + 1} treats "${check.id}" as a current-capability claim.`);
        }
      }
    }
  }
}

function requirePhrases() {
  const design = existsSync(path.join(repoRoot, 'DESIGN.md')) ? read('DESIGN.md') : '';
  const agents = existsSync(path.join(repoRoot, 'AGENTS.md')) ? read('AGENTS.md') : '';
  if (!design.includes(PHRASE.sixLanes) && !agents.includes(PHRASE.sixLanes)) {
    fail(`Required phrase "${PHRASE.sixLanes}" must appear in DESIGN.md or AGENTS.md.`);
  }
  const docsHit = collectMarkdownFiles()
    .filter((rel) => rel === 'DESIGN.md' || rel.startsWith('docs/'))
    .some((rel) => read(rel).includes(PHRASE.investigationRead));
  if (!docsHit) {
    fail(`Required phrase "${PHRASE.investigationRead}" must appear in DESIGN.md or docs/.`);
  }
}

function loadAncestorShas() {
  const listed = git(['rev-list', 'HEAD']);
  if (listed.status !== 0) {
    fail(`git rev-list HEAD failed: ${(listed.stderr || listed.stdout || '').trim()}`);
    return new Set();
  }
  return new Set(listed.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
}

function resolveCommit(sha) {
  const result = git(['rev-parse', '--verify', `${sha}^{commit}`]);
  if (result.status !== 0) return null;
  return (result.stdout || '').trim();
}

const markdown = read(LEDGER_REL);
const parsed = parseLedgerRows(markdown);
if (parsed.headerIndex < 0 || !parsed.columns) {
  fail(`${LEDGER_REL} must contain a table whose columns are exactly: ${REQUIRED_COLUMNS.join(' | ')}`);
}

const ancestors = loadAncestorShas();
const requireZeroPlanned = process.env.RDC_LEDGER_REQUIRE_ZERO_PLANNED === '1'
  || process.env.RDC_LEDGER_REQUIRE_ZERO_PLANNED === 'true';

for (const row of parsed.rows) {
  if (row.columnMismatch) {
    fail(`${LEDGER_REL}:${row.line} must have exactly ${REQUIRED_COLUMNS.length} columns.`);
    continue;
  }
  const task = row.Task;
  const verdict = row.Verdict;
  const sha = row['Commit SHA'];
  const date = row.Date;
  if (!VERDICTS.has(verdict)) {
    fail(`${LEDGER_REL}:${row.line} ${task} has invalid Verdict "${verdict}".`);
  }
  const shaEmpty = EMPTY_PLACEHOLDER.test(sha);
  if (verdict === 'verified') {
    if (shaEmpty || !SHA_RE.test(sha)) {
      fail(`${LEDGER_REL}:${row.line} ${task} is verified but Commit SHA is empty or not a git object id.`);
    } else {
      const resolved = resolveCommit(sha);
      if (!resolved || !ancestors.has(resolved)) {
        fail(`${LEDGER_REL}:${row.line} ${task} verified SHA "${sha}" is not in git rev-list HEAD.`);
      }
    }
    if (!DATE_RE.test(date)) {
      fail(`${LEDGER_REL}:${row.line} ${task} is verified but Date is not YYYY-MM-DD.`);
    }
  } else {
    if (!shaEmpty && !SHA_RE.test(sha)) {
      fail(`${LEDGER_REL}:${row.line} ${task} Commit SHA must be a git object id or —.`);
    }
    if (!EMPTY_PLACEHOLDER.test(date) && !DATE_RE.test(date)) {
      fail(`${LEDGER_REL}:${row.line} ${task} Date must be YYYY-MM-DD or —.`);
    }
  }
  if (U00_U03_RE.test(task) && (verdict === 'planned' || verdict === 'failed')) {
    fail(`${LEDGER_REL}:${row.line} ${task} must not remain ${verdict} after U04.`);
  }
  if (requireZeroPlanned && verdict === 'planned') {
    fail(`${LEDGER_REL}:${row.line} ${task} is still planned (RDC_LEDGER_REQUIRE_ZERO_PLANNED=1).`);
  }
}

const authorityFiles = ['DESIGN.md', 'AGENTS.md'].filter((rel) => existsSync(path.join(repoRoot, rel)));
for (const rel of authorityFiles) {
  const lines = read(rel).split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (lineHasPendingRunClaim(lines[i])) {
      fail(`${rel}:${i + 1} describes a verified ledger item as still pending (尚未跑/未跑).`);
    }
  }
}

scanForbiddenPhrases(collectMarkdownFiles());
requirePhrases();

if (!process.exitCode) {
  console.log('[acceptance-ledger] OK');
}
