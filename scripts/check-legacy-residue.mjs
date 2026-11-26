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
  leakFile: token('rdc-runtime-leak', '.json'),
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
  getRdcRuntimeContext: token('getRdc', 'RuntimeContext'),
  legacyFallback: token('legacy', ' fallback'),
  coldDataPascal: token('Cold', 'Data'),
  coldDataCamel: token('cold', 'Data'),
  coldDataKebab: token('cold', '-data'),
};

const HARNESS_REL = 'src/main/reports/artifactRecord.ts';

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
const extraFiles = ['DESIGN.md', 'ARCHITECTURE.md', 'AGENTS.md', 'package.json'];
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

  if (symbol === FORBIDDEN.legacyGlobalMirror || symbol === FORBIDDEN.getRdcRuntimeContext) {
    if (rel === 'scripts/check-orchestrator-facade.mjs') return true;
    if (rel === 'AGENTS.md' && /禁止/.test(line)) return true;
    if (rel.startsWith('docs/contracts/') && /禁止/.test(line)) return true;
    if (rel === 'ARCHITECTURE.md' && /禁止/.test(line)) return true;
  }

  if (symbol === FORBIDDEN.embeddingService) {
    if (rel === 'ARCHITECTURE.md' && /禁止恢复/.test(line)) return true;
    if (rel.startsWith('docs/architecture/') && /禁止恢复/.test(line)) return true;
    if (rel === 'docs/product/acceptance-ledger.md' && /U02-delete-embedding|禁止恢复/.test(line)) return true;
  }

  if (
    symbol === FORBIDDEN.stagedHandoff ||
    symbol === FORBIDDEN.leakFile ||
    symbol === FORBIDDEN.planPhases ||
    symbol === FORBIDDEN.modeCapabilities ||
    symbol === FORBIDDEN.intakeContext ||
    symbol === FORBIDDEN.gateResult ||
    symbol === FORBIDDEN.writeScope ||
    symbol === FORBIDDEN.harnessStatus ||
    symbol === FORBIDDEN.contextPacket ||
    symbol === FORBIDDEN.askAgentMd ||
    symbol === FORBIDDEN.groupAskTurns ||
    symbol === FORBIDDEN.askTurn ||
    symbol === FORBIDDEN.legacyFallback
  ) {
    if (rel === 'ARCHITECTURE.md' && /\|\s*`/.test(line)) return true;
    if (rel === 'docs/product/acceptance-ledger.md' && /U03-/.test(line)) return true;
  }

  if (symbol === FORBIDDEN.planPhases && rel === 'scripts/check-investigation-system.mjs') {
    return false;
  }

  return false;
};

const isLegalWordContext = (rel, line) => {
  if (/OpenAI.compatible/.test(line)) return true;
  if (line.includes('pdfjs-dist/legacy')) return true;
  if (/Semantic Token|图形学 Semantics/.test(line)) return true;
  if (rel.endsWith('semanticContext.ts') || rel.includes('semanticContext')) return true;
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
  const re = wordBoundary ? new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`) : new RegExp(escaped);
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

const collectPathHits = (relativePath) => (existsSync(path.join(repoRoot, relativePath)) ? [relativePath] : []);

const collectExportHits = (symbol) => {
  const exportFiles = ['src/shared/constants/index.ts'];
  const hits = [];
  for (const rel of exportFiles) {
    const full = path.join(repoRoot, rel);
    if (!existsSync(full)) continue;
    const lines = readFileSync(full, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (
        trimmed === symbol ||
        trimmed.endsWith(` ${symbol}`) ||
        trimmed.endsWith(`, ${symbol}`) ||
        trimmed.startsWith(`${symbol},`)
      ) {
        if (symbol === FORBIDDEN.writeScope && trimmed.includes(token('AgentManifest', 'WriteScope'))) return;
        hits.push(`${rel}:${index + 1}:${trimmed}`);
      }
    });
  }
  return hits;
};

const collectDynamicImportHits = (needle) => {
  const hits = [];
  const importRe = new RegExp(
    `import\\s*\\(\\s*['"\`][^'"\`]*${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^'"\`]*['"\`]`,
  );
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
  {
    id: 'rdc-runtime-leak.json',
    hits: [...collectPatternHits(FORBIDDEN.leakFile), ...collectPathHits(FORBIDDEN.leakFile)],
  },
  { id: 'PLAN_PHASES', hits: collectPatternHits(FORBIDDEN.planPhases) },
  {
    id: 'WriteScope',
    hits: [
      ...collectPatternHits(FORBIDDEN.writeScope, { wordBoundary: true }),
      ...collectExportHits(FORBIDDEN.writeScope),
    ],
  },
  {
    id: 'IntakeContext',
    hits: [...collectPatternHits(FORBIDDEN.intakeContext), ...collectExportHits(FORBIDDEN.intakeContext)],
  },
  { id: 'GateResult', hits: [...collectPatternHits(FORBIDDEN.gateResult), ...collectExportHits(FORBIDDEN.gateResult)] },
  {
    id: 'MODE_CAPABILITIES',
    hits: [...collectPatternHits(FORBIDDEN.modeCapabilities), ...collectExportHits(FORBIDDEN.modeCapabilities)],
  },
  {
    id: 'EmbeddingExecutionService',
    hits: [
      ...collectPatternHits(FORBIDDEN.embeddingService),
      ...collectPathHits(`${FORBIDDEN.embeddingRuntimeDir}.ts`),
      ...collectPathHits(`${FORBIDDEN.embeddingRuntimeDir}.test.ts`),
      ...collectDynamicImportHits(FORBIDDEN.embeddingService),
      ...collectExportHits(FORBIDDEN.embeddingService),
    ],
  },
  {
    id: 'Ask.agent.md',
    hits: [...collectPatternHits(FORBIDDEN.askAgentMd), ...collectPathHits(`.github/agents/${FORBIDDEN.askAgentMd}`)],
  },
  { id: 'groupAskTurns', hits: collectPatternHits(FORBIDDEN.groupAskTurns) },
  { id: 'AskTurn', hits: collectPatternHits(FORBIDDEN.askTurn, { wordBoundary: true }) },
  { id: 'HarnessStatus', hits: collectPatternHits(FORBIDDEN.harnessStatus) },
  { id: 'ContextPacket', hits: collectPatternHits(FORBIDDEN.contextPacket) },
  { id: 'legacyGlobalMirror', hits: collectPatternHits(FORBIDDEN.legacyGlobalMirror) },
  { id: 'getRdcRuntimeContext', hits: collectPatternHits(FORBIDDEN.getRdcRuntimeContext) },
  { id: 'legacy-fallback-wording', hits: collectPatternHits(FORBIDDEN.legacyFallback) },
  { id: 'ColdData', hits: collectPatternHits(FORBIDDEN.coldDataPascal) },
  { id: 'coldData', hits: collectPatternHits(FORBIDDEN.coldDataCamel) },
  { id: 'cold-data', hits: collectPatternHits(FORBIDDEN.coldDataKebab) },
];

// Version numbers (AGENTS.md §2.3): persisted formats carry no version marker and our own names, ids and files carry
// no iteration number; a format change fails fast and the user deletes the data. Names owned by other programs keep
// theirs and are listed below with the reason.
const VERSION_SCAN_ROOT = 'src';
const VERSION_SCAN_FILES = [
  'resources/agent-runtime/rdc-tool-catalog-identity.json',
  'resources/agent-runtime/rdc-tool-guide-members.json',
];
const CODE_FILE = /\.(?:ts|tsx|js|mjs|cjs)$/;
const TEST_FILE = /\.test\.(?:ts|tsx)$/;
const FORMAT_MARKER = /\b(?:schema|record|format)Version\b|\b(?:[A-Z][A-Z0-9]*_)*SCHEMA_VERSION\b/;
const PROTOCOL_MARKER = /\bschema_version\b/;
// RDC-Tool's public protocol: the CLI envelope and the operation catalog carry schema_version.
const RDC_TOOL_PROTOCOL_FILES = new Set([
  'src/main/rdc/RdcCliInvokerService.ts',
  'src/main/rdc/RdcNativeProtocol.ts',
  'src/main/rdc/rdcCatalogIdentity.ts',
]);
const VERSIONED_IDENTIFIER = /\b[A-Za-z_$][\w$]*?(?:[a-z0-9]V|_V)\d+(?!\d)[\w$]*|\bv\d+[A-Z][\w$]*/g;
const VERSIONED_ID = /(?<![\w/@.-])(?:[A-Za-z][A-Za-z0-9]*[-.])+v\d+(?!\d)(?:[-.:][\w.:-]*)?/g;
const VERSIONED_NAMESPACE = /['"`][a-z][a-z0-9]*(?:[.-][a-z0-9]+)+\/\d+['"`]/g;
const VERSIONED_PATH_SEGMENT = /(?:^|[-_.])v\d+(?=$|[-_.])|[a-z0-9]V\d+(?![a-z0-9])/;
const EXTERNAL_IDENTIFIERS = [
  /^SigV4$/, // AWS Signature Version 4
  /^AwsV4Signer$/, // aws4fetch signer class
  /^(?:Shared|LanguageModel|EmbeddingModel|ImageModel|SpeechModel|TranscriptionModel|Provider)V\d+\w*$/, // AI SDK types
];
const EXTERNAL_IDS = [
  /^(?:deepseek|mimo|moonshot|cohere|bge|nomic|text-embedding)-/i, // vendor model ids
  /^amazon\.nova-/, // Bedrock model id
  /^codex-theme-v1:?$/, // the Codex theme share format, which the theme import names to refuse
  /^sk-or-v1-$/, // OpenRouter API key prefix
  /^steps-v1$/, // Google Interactions reasoning artifact version from its provider manifest
  /^jerome-benoit\/sap-ai-provider-v2$/, // npm package name
];
const EXTERNAL_PATHS = new Set([
  // The Vercel v0 provider: manifest files are named by provider id.
  'src/shared/provider-catalog/manifests/identities/v0.json',
  'src/shared/provider-catalog/manifests/surfaces/v0.json',
]);

const versionScanFiles = [
  ...walkFiles(VERSION_SCAN_ROOT),
  ...VERSION_SCAN_FILES.filter((rel) => existsSync(path.join(repoRoot, rel))),
];

const versionPathHits = walkFiles(VERSION_SCAN_ROOT).filter(
  (rel) => !EXTERNAL_PATHS.has(rel) && rel.split('/').some((segment) => VERSIONED_PATH_SEGMENT.test(segment)),
);

const versionContentHits = [];
for (const rel of versionScanFiles) {
  const code = CODE_FILE.test(rel);
  const checksMarkers = !TEST_FILE.test(rel);
  readFileSync(path.join(repoRoot, rel), 'utf8')
    .split(/\r?\n/)
    .forEach((line, index) => {
      const where = `${rel}:${index + 1}`;
      if (checksMarkers && FORMAT_MARKER.test(line)) versionContentHits.push(`${where}: format version ${line.trim()}`);
      if (checksMarkers && !RDC_TOOL_PROTOCOL_FILES.has(rel) && PROTOCOL_MARKER.test(line))
        versionContentHits.push(`${where}: format version ${line.trim()}`);
      if (!code) return;
      for (const match of line.matchAll(VERSIONED_IDENTIFIER)) {
        if (!EXTERNAL_IDENTIFIERS.some((allowed) => allowed.test(match[0])))
          versionContentHits.push(`${where}: versioned identifier ${match[0]}`);
      }
      for (const match of line.matchAll(VERSIONED_ID)) {
        if (!EXTERNAL_IDS.some((allowed) => allowed.test(match[0])))
          versionContentHits.push(`${where}: versioned id ${match[0]}`);
      }
      for (const match of line.matchAll(VERSIONED_NAMESPACE))
        versionContentHits.push(`${where}: versioned id ${match[0]}`);
    });
}

rules.push({ id: 'version-numbered-path', hits: versionPathHits }, { id: 'version-numbers', hits: versionContentHits });

for (const rule of rules) {
  reportHits(rule.id, [...new Set(rule.hits)]);
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log('[legacy-residue] OK (0 hits)');
