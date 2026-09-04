#!/usr/bin/env node
/**
 * Zero-hit residue gate for deleted legacy names, dead types, and unread leak files.
 * Tokens are assembled at runtime so this file does not contain the forbidden literals.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const selfRel = 'scripts/check-legacy-residue.mjs';

const SKIP_DIRS = new Set(['node_modules', 'out', 'dist', 'coverage', '.git', '.cursor']);
const SOURCE_FILE = /\.(?:ts|tsx|js|mjs|cjs|json|md)$/;

const fail = (message) => {
  console.error(`[legacy-residue] ${message}`);
  process.exitCode = 1;
};

const token = (...parts) => parts.join('');

const FORBIDDEN = {
  stagedHandoff: token('staged', '_handoff'),
  leakFile: token('rdx-runtime-leak', '.json'),
  planPhases: token('PLAN', '_PHASES'),
  writeScope: 'WriteScope',
  intakeContext: token('Intake', 'Context'),
  gateResult: token('Gate', 'Result'),
  modeCapabilities: token('MODE', '_CAPABILITIES'),
  embeddingService: token('Embedd', 'ingExecutionService'),
  embeddingRuntimeDir: token('src/main/settings/Embedd', 'ingExecutionService'),
  askAgentMd: token('Ask', '.agent.md'),
  groupAskTurns: token('group', 'AskTurns'),
  askTurn: token('Ask', 'Turn'),
  harnessStatus: token('Harness', 'Status'),
  contextPacket: token('Context', 'Packet'),
  legacyGlobalMirror: token('legacy', 'GlobalMirror'),
  getRdxRuntimeContext: token('getRdx', 'RuntimeContext'),
  legacyFallback: token('legacy', ' fallback'),
};

const HARNESS_REL = 'src/shared/types/harness.ts';

const walkFiles = (relativeRoot) => {
  const root = path.join(repoRoot, relativeRoot);
  const out = [];
  if (!existsSync(root)) return out;
  const visit = (current) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      const rel = path.relative(repoRoot, full).replaceAll('\\', '/');
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        visit(full);
        continue;
      }
      if (SOURCE_FILE.test(entry.name)) out.push(rel);
    }
  };
  visit(root);
  return out;
};

const scanRoots = ['src', 'scripts', 'resources', 'docs', '.github'];
const extraFiles = ['DESIGN.md', 'AGENTS.md', 'package.json'];
const files = [
  ...new Set([
    ...scanRoots.flatMap((root) => walkFiles(root)),
    ...extraFiles.filter((rel) => existsSync(path.join(repoRoot, rel))),
  ]),
].filter((rel) => rel !== selfRel);

const isAgentManifestWriteScope = (line) => line.includes(token('AgentManifest', 'WriteScope'));

const isExactSymbolAllowlist = (rel, line, symbol) => {
  if (symbol === FORBIDDEN.writeScope && isAgentManifestWriteScope(line)) return true;
  if (symbol === FORBIDDEN.askTurn && line.includes(FORBIDDEN.groupAskTurns)) return false;

  if (symbol === FORBIDDEN.legacyGlobalMirror || symbol === FORBIDDEN.getRdxRuntimeContext) {
    if (rel === 'scripts/check-orchestrator-facade.mjs') return true;
    if (rel === 'AGENTS.md' && /禁止/.test(line)) return true;
    if (rel.startsWith('docs/contracts/') && /禁止/.test(line)) return true;
    if (rel === 'DESIGN.md' && /禁止/.test(line)) return true;
  }

  if (symbol === FORBIDDEN.embeddingService) {
    if (rel === 'DESIGN.md' && /禁止恢复/.test(line)) return true;
    if (rel.startsWith('docs/architecture/') && /禁止恢复/.test(line)) return true;
    if (rel === 'docs/product/acceptance-ledger.md' && /U02-delete-embedding|禁止恢复/.test(line)) return true;
  }

  if (
    symbol === FORBIDDEN.stagedHandoff
    || symbol === FORBIDDEN.leakFile
    || symbol === FORBIDDEN.planPhases
    || symbol === FORBIDDEN.modeCapabilities
    || symbol === FORBIDDEN.intakeContext
    || symbol === FORBIDDEN.gateResult
    || symbol === FORBIDDEN.writeScope
    || symbol === FORBIDDEN.harnessStatus
    || symbol === FORBIDDEN.contextPacket
    || symbol === FORBIDDEN.askAgentMd
    || symbol === FORBIDDEN.groupAskTurns
    || symbol === FORBIDDEN.askTurn
    || symbol === FORBIDDEN.legacyFallback
  ) {
    if (rel === 'DESIGN.md' && /\|\s*`/.test(line)) return true;
    if (rel === 'docs/product/acceptance-ledger.md' && /U03-/.test(line)) return true;
  }

  if (symbol === FORBIDDEN.planPhases && rel === 'scripts/check-investigation-system.mjs') {
    return false;
  }

  return false;
};

const isLegalWordContext = (rel, line) => {
  if (/\bdeprecated\b/.test(line)) {
    if (/provider|lifecycle|Knowledge|status:\s*'deprecated'|lifecycle === 'deprecated'/.test(line)) return true;
  }
  if (/OpenAI.compatible/.test(line)) return true;
  if (line.includes('pdfjs-dist/legacy')) return true;
  if (/Semantic Token|图形学 Semantics/.test(line)) return true;
  if (rel.endsWith('semanticHash.ts') || rel.endsWith('semanticContext.ts')) return true;
  if (rel.includes('semanticHash') || rel.includes('semanticContext')) return true;
  if (line.includes(token('LEGACY_UNKNOWN_PROFILE', '_ID'))) return true;
  if (line.includes(token('legacy', ':unknown'))) return true;
  return false;
};

const reportHits = (id, hits) => {
  if (hits.length === 0) return;
  fail(`${id}: ${hits.length} hit(s)`);
  for (const hit of hits.slice(0, 20)) {
    fail(`  ${hit}`);
  }
};

const collectPatternHits = (needle, { wordBoundary = false } = {}) => {
  const hits = [];
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = wordBoundary
    ? new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`)
    : new RegExp(escaped);
  for (const rel of files) {
    const content = readFileSync(path.join(repoRoot, rel), 'utf8');
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!re.test(line)) return;
      if (isLegalWordContext(rel, line)) return;
      if (isExactSymbolAllowlist(rel, line, needle)) return;
      hits.push(`${rel}:${index + 1}:${line.trim()}`);
    });
  }
  return hits;
};

const collectPathHits = (relativePath) => (
  existsSync(path.join(repoRoot, relativePath)) ? [relativePath] : []
);

const collectExportHits = (symbol) => {
  const exportFiles = [
    'scripts/fidelity/shared-exports.txt',
    'src/shared/types/index.ts',
    'src/shared/constants/index.ts',
  ];
  const hits = [];
  for (const rel of exportFiles) {
    const full = path.join(repoRoot, rel);
    if (!existsSync(full)) continue;
    const lines = readFileSync(full, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed === symbol || trimmed.endsWith(` ${symbol}`) || trimmed.endsWith(`, ${symbol}`) || trimmed.startsWith(`${symbol},`)) {
        if (symbol === FORBIDDEN.writeScope && trimmed.includes(token('AgentManifest', 'WriteScope'))) return;
        hits.push(`${rel}:${index + 1}:${trimmed}`);
      }
    });
  }
  return hits;
};

const collectDynamicImportHits = (needle) => {
  const hits = [];
  const importRe = new RegExp(`import\\s*\\(\\s*['"\`][^'"\`]*${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^'"\`]*['"\`]`);
  const mockRe = new RegExp(`vi\\.mock\\(\\s*['"\`][^'"\`]*${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  for (const rel of files) {
    if (!rel.startsWith('src/') && !rel.startsWith('scripts/')) continue;
    const content = readFileSync(path.join(repoRoot, rel), 'utf8');
    if (importRe.test(content) || mockRe.test(content)) {
      hits.push(`${rel}:dynamic-import-or-mock`);
    }
  }
  return hits;
};

const harnessPath = path.join(repoRoot, HARNESS_REL);
if (!existsSync(harnessPath)) {
  fail(`${HARNESS_REL} must remain (do not rename).`);
} else {
  const harness = readFileSync(harnessPath, 'utf8');
  if (!harness.includes('export type ArtifactKind') || !harness.includes('export interface ArtifactRecord')) {
    fail(`${HARNESS_REL} must keep ArtifactKind / ArtifactRecord.`);
  }
  for (const dead of [FORBIDDEN.harnessStatus, token('Evidence', 'Record'), FORBIDDEN.contextPacket]) {
    if (harness.includes(dead)) {
      fail(`${HARNESS_REL} still contains deleted harness type ${dead}.`);
    }
  }
}

const rules = [
  { id: 'staged_handoff', hits: collectPatternHits(FORBIDDEN.stagedHandoff) },
  { id: 'rdx-runtime-leak.json', hits: [
    ...collectPatternHits(FORBIDDEN.leakFile),
    ...collectPathHits(FORBIDDEN.leakFile),
  ] },
  { id: 'PLAN_PHASES', hits: collectPatternHits(FORBIDDEN.planPhases) },
  { id: 'WriteScope', hits: [
    ...collectPatternHits(FORBIDDEN.writeScope, { wordBoundary: true }),
    ...collectExportHits(FORBIDDEN.writeScope),
  ] },
  { id: 'IntakeContext', hits: [
    ...collectPatternHits(FORBIDDEN.intakeContext),
    ...collectExportHits(FORBIDDEN.intakeContext),
  ] },
  { id: 'GateResult', hits: [
    ...collectPatternHits(FORBIDDEN.gateResult),
    ...collectExportHits(FORBIDDEN.gateResult),
  ] },
  { id: 'MODE_CAPABILITIES', hits: [
    ...collectPatternHits(FORBIDDEN.modeCapabilities),
    ...collectExportHits(FORBIDDEN.modeCapabilities),
  ] },
  { id: 'EmbeddingExecutionService', hits: [
    ...collectPatternHits(FORBIDDEN.embeddingService),
    ...collectPathHits(`${FORBIDDEN.embeddingRuntimeDir}.ts`),
    ...collectPathHits(`${FORBIDDEN.embeddingRuntimeDir}.test.ts`),
    ...collectDynamicImportHits(FORBIDDEN.embeddingService),
    ...collectExportHits(FORBIDDEN.embeddingService),
  ] },
  { id: 'Ask.agent.md', hits: [
    ...collectPatternHits(FORBIDDEN.askAgentMd),
    ...collectPathHits(`.github/agents/${FORBIDDEN.askAgentMd}`),
  ] },
  { id: 'groupAskTurns', hits: collectPatternHits(FORBIDDEN.groupAskTurns) },
  { id: 'AskTurn', hits: collectPatternHits(FORBIDDEN.askTurn, { wordBoundary: true }) },
  { id: 'HarnessStatus', hits: collectPatternHits(FORBIDDEN.harnessStatus) },
  { id: 'ContextPacket', hits: collectPatternHits(FORBIDDEN.contextPacket) },
  { id: 'legacyGlobalMirror', hits: collectPatternHits(FORBIDDEN.legacyGlobalMirror) },
  { id: 'getRdxRuntimeContext', hits: collectPatternHits(FORBIDDEN.getRdxRuntimeContext) },
  { id: 'legacy-fallback-wording', hits: collectPatternHits(FORBIDDEN.legacyFallback) },
];

for (const rule of rules) {
  reportHits(rule.id, [...new Set(rule.hits)]);
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log('[legacy-residue] OK (0 hits)');
