#!/usr/bin/env node
/**
 * Shared structural-debt ratchet for Knowledge / Investigation system gates.
 * Canonical rules live in the calling check scripts. Debt JSON only stores ids.
 */

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

export const DEBT_SCHEMA_VERSION = 1;
export const WAVE_CLEAR_BY = 6;
export const ZERO_SHA = /^0{7,40}$/;
const SKIP_DIRS = new Set(['node_modules', 'out', 'dist', 'coverage', '.git']);
const SOURCE_FILE = /\.(?:ts|tsx|js|mjs|cjs|json|md)$/;
const TEST_FILE = /\.test\.(?:ts|tsx|js|mjs)$/;
const CANONICAL_TASKS_DIR = 'src/main/agent-runtime/tasks/';

export function toPosix(relativePath) {
  return String(relativePath).replaceAll('\\', '/');
}

export function defaultRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

export function isDirectInvocation(metaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return path.normalize(fileURLToPath(metaUrl)) === path.normalize(path.resolve(argv1));
  } catch {
    return false;
  }
}

export function isCiEnv(env = process.env) {
  return env.CI === 'true' || env.CI === '1';
}

export function parseArgValue(argv, name, envName, env = process.env) {
  const flag = `--${name}`;
  const index = argv.indexOf(flag);
  if (index >= 0) {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${flag} requires a value`);
    }
    return value;
  }
  const prefix = `${flag}=`;
  const inline = argv.find((entry) => entry.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  if (envName && env[envName]) return env[envName];
  return '';
}

export function walkFiles(root, { includeTests = false } = {}) {
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
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        visit(full);
        continue;
      }
      if (!SOURCE_FILE.test(entry.name)) continue;
      if (!includeTests && TEST_FILE.test(entry.name)) continue;
      out.push(full);
    }
  };
  visit(root);
  return out;
}

export function readOptional(filePath) {
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf8');
}

function compilePattern(pattern) {
  if (!pattern) return null;
  return new RegExp(pattern);
}

function sourceMatches(source, rule) {
  const matcher = compilePattern(rule.pattern);
  const found = matcher ? matcher.test(source) : true;
  if (!found) return false;
  if (rule.unlessPattern && new RegExp(rule.unlessPattern).test(source)) return false;
  return true;
}

function resolveRulePath(repoRoot, file) {
  return path.join(repoRoot, ...toPosix(file).split('/').filter(Boolean));
}

function relativePosix(repoRoot, absolute) {
  return toPosix(path.relative(repoRoot, absolute));
}

export const FIVE_KNOWLEDGE_TOOLS = [
  'knowledge_browse',
  'knowledge_search',
  'knowledge_read',
  'knowledge_compile',
  'knowledge_candidate_create',
];

export function parseAgentMarkdownTools(source) {
  const tokens = [];
  const bracket = /(?:^|\n)tools:\s*\[([^\]]*)\]/.exec(source);
  if (bracket) {
    for (const match of bracket[1].matchAll(/['"]([^'"]+)['"]|([A-Za-z0-9_.:-]+)/g)) {
      tokens.push(match[1] || match[2]);
    }
    return tokens.filter(Boolean);
  }
  const yaml = /(?:^|\n)tools:\s*((?:\n[ \t]+-[ \t]+\S+)+)/.exec(source);
  if (yaml) {
    for (const match of yaml[1].matchAll(/-[ \t]+(\S+)/g)) {
      tokens.push(match[1].replace(/^['"]|['"]$/g, ''));
    }
  }
  return tokens;
}

export function profileHasKnowledgeCeiling(source) {
  const tokens = parseAgentMarkdownTools(source);
  if (tokens.includes('knowledge')) return true;
  return FIVE_KNOWLEDGE_TOOLS.every((id) => tokens.includes(id));
}

export function evaluateRule(rule, repoRoot) {
  const posixFile = rule.file ? toPosix(rule.file) : '';
  const target = posixFile ? resolveRulePath(repoRoot, posixFile) : repoRoot;
  const probe = rule.probe || (rule.pattern ? 'source-pattern' : 'file-exists');

  if (probe === 'contract-suite') {
    const present = existsSync(target) && statSync(target).isFile();
    return {
      id: rule.id,
      kind: rule.kind,
      file: posixFile,
      pattern: rule.pattern || '',
      hit: rule.kind === 'missing' ? !present : present,
      present,
    };
  }

  if (probe === 'file-exists') {
    const present = existsSync(target) && statSync(target).isFile();
    const hit = rule.kind === 'missing' ? !present : present;
    return { id: rule.id, kind: rule.kind, file: posixFile, pattern: rule.pattern || '', hit, present };
  }

  if (probe === 'dir-exists') {
    const present = existsSync(target) && statSync(target).isDirectory();
    const hit = rule.kind === 'missing' ? !present : present;
    return { id: rule.id, kind: rule.kind, file: posixFile, pattern: rule.pattern || '', hit, present };
  }

  if (probe === 'profile-knowledge-ceiling') {
    const presentFile = existsSync(target) && statSync(target).isFile();
    if (!presentFile) {
      return {
        id: rule.id,
        kind: rule.kind,
        file: posixFile,
        pattern: rule.pattern || 'knowledge',
        hit: rule.kind === 'missing',
        present: false,
      };
    }
    const satisfied = profileHasKnowledgeCeiling(readFileSync(target, 'utf8'));
    return {
      id: rule.id,
      kind: rule.kind,
      file: posixFile,
      pattern: rule.pattern || 'knowledge',
      hit: rule.kind === 'missing' ? !satisfied : satisfied,
      present: satisfied,
    };
  }

  if (probe === 'walk-path-and-content') {
    const roots = Array.isArray(rule.roots) && rule.roots.length > 0 ? rule.roots : [rule.file];
    const includeTests = Boolean(rule.includeTests);
    const matcher = compilePattern(rule.pattern);
    const matches = [];
    for (const root of roots) {
      const rootTarget = resolveRulePath(repoRoot, root);
      if (!existsSync(rootTarget)) continue;
      const files = walkFiles(rootTarget, { includeTests });
      for (const file of files) {
        const rel = relativePosix(repoRoot, file);
        if (matcher && matcher.test(rel)) {
          matches.push(rel);
          continue;
        }
        const source = readFileSync(file, 'utf8');
        if (sourceMatches(source, rule)) matches.push(rel);
      }
    }
    const present = matches.length > 0;
    return {
      id: rule.id,
      kind: rule.kind,
      file: matches[0] || posixFile,
      pattern: rule.pattern || '',
      hit: rule.kind === 'missing' ? !present : present,
      present,
      matches,
    };
  }

  if (probe === 'walk-pattern') {
    if (!existsSync(target)) {
      return {
        id: rule.id,
        kind: rule.kind,
        file: posixFile,
        pattern: rule.pattern || '',
        hit: rule.kind === 'missing',
        present: false,
        matches: [],
      };
    }
    const includeTests = Boolean(rule.includeTests);
    const files = walkFiles(target, { includeTests });
    const matches = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      if (sourceMatches(source, rule)) matches.push(relativePosix(repoRoot, file));
    }
    const present = matches.length > 0;
    return {
      id: rule.id,
      kind: rule.kind,
      file: matches[0] || posixFile,
      pattern: rule.pattern || '',
      hit: rule.kind === 'missing' ? !present : present,
      present,
      matches,
    };
  }

  const presentFile = existsSync(target) && statSync(target).isFile();
  if (!presentFile) {
    return {
      id: rule.id,
      kind: rule.kind,
      file: posixFile,
      pattern: rule.pattern || '',
      hit: rule.kind === 'missing',
      present: false,
    };
  }
  const source = readFileSync(target, 'utf8');
  const matched = sourceMatches(source, rule);
  return {
    id: rule.id,
    kind: rule.kind,
    file: posixFile,
    pattern: rule.pattern || '',
    hit: rule.kind === 'missing' ? !matched : matched,
    present: matched,
  };
}

export function evaluateRegistry(registry, repoRoot) {
  const measured = [];
  for (const rule of registry) {
    const result = evaluateRule(rule, repoRoot);
    if (result.hit) measured.push(result);
  }
  measured.sort((a, b) => a.id.localeCompare(b.id));
  return measured;
}

export function normalizeRequiredCases(rule) {
  const cases = Array.isArray(rule?.requiredCases) ? rule.requiredCases : [];
  return cases.map((entry, index) => {
    const title = typeof entry?.title === 'string' ? entry.title : '';
    const fullName = typeof entry?.fullName === 'string' ? entry.fullName : '';
    const minAssertions = entry?.minAssertions;
    return {
      title,
      fullName,
      minAssertions: Number.isInteger(minAssertions) ? minAssertions : 0,
      index,
    };
  });
}

export function validateRegistry(registry) {
  const errors = [];
  const seen = new Set();
  for (const rule of registry) {
    if (!rule?.id || !rule.kind || !rule.probe || !rule.file) {
      errors.push(`registry rule missing id/kind/file/probe: ${rule?.id ?? '(unknown)'}`);
      continue;
    }
    if (rule.kind !== 'missing' && rule.kind !== 'forbidden') {
      errors.push(`${rule.id}: kind must be missing|forbidden`);
    }
    if (seen.has(rule.id)) errors.push(`duplicate registry id: ${rule.id}`);
    seen.add(rule.id);
    if (rule.probe === 'contract-suite') {
      const cases = normalizeRequiredCases(rule);
      if (cases.length === 0) {
        errors.push(`${rule.id}: contract-suite requires requiredCases[{title|fullName,minAssertions>=1}]`);
        continue;
      }
      for (const entry of cases) {
        if (!entry.title && !entry.fullName) {
          errors.push(`${rule.id}: requiredCases[${entry.index}] needs exact title or fullName`);
        }
        if (entry.minAssertions < 1) {
          errors.push(`${rule.id}: requiredCases[${entry.title || entry.fullName}] minAssertions must be >= 1`);
        }
      }
    }
  }
  return errors;
}

const DEBT_KEYS = ['schemaVersion', 'waveClearBy', 'maxHits', 'ids'];

export function parseDebtDocument(raw, label) {
  const debt = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!debt || typeof debt !== 'object' || Array.isArray(debt)) throw new Error(`${label} is not an object`);
  const keys = Object.keys(debt);
  if (keys.length !== DEBT_KEYS.length || DEBT_KEYS.some((key) => !keys.includes(key))) {
    throw new Error(`${label} keys must be exactly ${DEBT_KEYS.join(',')}; got ${keys.join(',') || '(empty)'}`);
  }
  if (debt.schemaVersion !== DEBT_SCHEMA_VERSION) {
    throw new Error(`${label} schemaVersion must be ${DEBT_SCHEMA_VERSION}`);
  }
  if (debt.waveClearBy !== WAVE_CLEAR_BY) {
    throw new Error(`${label} waveClearBy must be ${WAVE_CLEAR_BY}`);
  }
  if (!Array.isArray(debt.ids) || debt.ids.some((id) => typeof id !== 'string')) {
    throw new Error(`${label} ids must be a string array`);
  }
  if (!Number.isInteger(debt.maxHits)) {
    throw new Error(`${label} maxHits must be an integer`);
  }
  const unique = new Set(debt.ids);
  if (unique.size !== debt.ids.length) throw new Error(`${label} ids must be unique`);
  const sorted = [...debt.ids].sort((a, b) => a.localeCompare(b));
  if (debt.ids.some((id, index) => id !== sorted[index])) {
    throw new Error(`${label} ids must be stably sorted`);
  }
  if (debt.ids.length !== debt.maxHits) {
    throw new Error(`${label} ids.length (${debt.ids.length}) must equal maxHits (${debt.maxHits})`);
  }
  return { schemaVersion: DEBT_SCHEMA_VERSION, waveClearBy: WAVE_CLEAR_BY, maxHits: debt.maxHits, ids: [...debt.ids] };
}

export function readDebtFile(filePath, label = 'debt') {
  if (!existsSync(filePath)) throw new Error(`${label} file missing: ${filePath}`);
  return parseDebtDocument(readFileSync(filePath, 'utf8'), label);
}

export function formatDebt(ids) {
  const sorted = [...ids].sort((a, b) => a.localeCompare(b));
  return {
    schemaVersion: DEBT_SCHEMA_VERSION,
    waveClearBy: WAVE_CLEAR_BY,
    maxHits: sorted.length,
    ids: sorted,
  };
}

function formatHit(prefix, hit) {
  return `[${prefix}] ${hit.id} file=${hit.file || '(repo)'} pattern=${hit.pattern || '(none)'}`;
}

export function compareMeasuredToDebt(measured, debt, registry) {
  const errors = [];
  const registryIds = new Set(registry.map((rule) => rule.id));
  const measuredIds = measured.map((hit) => hit.id);
  const measuredSet = new Set(measuredIds);
  const debtSet = new Set(debt.ids);

  for (const id of debt.ids) {
    if (!registryIds.has(id)) {
      errors.push(`stale debt id not in registry: ${id}`);
    }
  }
  for (const hit of measured) {
    if (!debtSet.has(hit.id)) {
      errors.push(`new hit not in debt: ${formatHit('NEW', hit)}`);
    }
  }
  for (const id of debt.ids) {
    if (!measuredSet.has(id)) {
      const rule = registry.find((entry) => entry.id === id);
      errors.push(
        `stale debt id (no longer a hit): ${id} file=${rule?.file || '(unknown)'} pattern=${rule?.pattern || '(none)'}`,
      );
    }
  }
  if (measuredIds.length !== debt.maxHits) {
    errors.push(`measured hits ${measuredIds.length} !== maxHits ${debt.maxHits}`);
  }
  return errors;
}

export function compareHistoricalDebt(current, previous) {
  const errors = [];
  const previousSet = new Set(previous.ids);
  for (const id of current.ids) {
    if (!previousSet.has(id)) {
      errors.push(`historical monotonic: cannot add debt id ${id}`);
    }
  }
  if (current.maxHits > previous.maxHits) {
    errors.push(`historical monotonic: maxHits grew ${previous.maxHits} → ${current.maxHits}`);
  }
  return errors;
}

export function gitShow(repoRoot, ref, posixPath) {
  return spawnSync('git', ['show', `${ref}:${toPosix(posixPath)}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
}

export function resolveBaseRef(argv, env = process.env) {
  return parseArgValue(argv, 'base-ref', 'RDC_SYSTEM_DEBT_BASE_REF', env).trim();
}

export function classifyBaseRef(baseRef, { ci = isCiEnv() } = {}) {
  if (!baseRef) {
    return ci
      ? { mode: 'ci-missing', message: 'CI requires --base-ref or RDC_SYSTEM_DEBT_BASE_REF' }
      : { mode: 'local-skip', message: 'historical monotonic skipped (no base-ref)' };
  }
  if (ZERO_SHA.test(baseRef)) {
    return { mode: 'wave0-init', message: `Wave0 initialization (zero base-ref ${baseRef})` };
  }
  return { mode: 'compare', message: `compare against ${baseRef}` };
}

export function loadHistoricalDebt(repoRoot, baseRef, debtRelativePath) {
  const shown = gitShow(repoRoot, baseRef, debtRelativePath);
  if (shown.status === 0) {
    return { mode: 'compare', debt: parseDebtDocument(shown.stdout, `git show ${baseRef}:${debtRelativePath}`) };
  }
  const stderr = `${shown.stderr || ''} ${shown.stdout || ''}`;
  if (/does not exist|exists on disk, but not in/i.test(stderr)) {
    return { mode: 'wave0-init', message: `Wave0 initialization (base ${baseRef} has no ${toPosix(debtRelativePath)})` };
  }
  throw new Error(`unable to read ${toPosix(debtRelativePath)} from ${baseRef}: ${stderr.trim() || `exit ${shown.status}`}`);
}

const FORBIDDEN_KNOWLEDGE_WRITE_TOKENS = [
  'knowledge_write',
  'knowledge_promote',
  'knowledge_update',
  'knowledge_deprecate',
];
const GRAPH_CLASS_RE = /export\s+(?:class|function|const)\s+InvestigationGraph(?:Service)?\b/;
const TASK_STORE_IMPLEMENTS_RE = /implements\s+TaskStore\b/;
const TASK_STORE_EXTENDS_RE = /extends\s+[A-Za-z0-9_]*TaskStore\b/;
const TASK_STORE_CLASS_RE = /(?:export\s+)?class\s+[A-Za-z0-9_]*TaskStore\b/;
const TASK_STORE_IMPORT_RE = /import\s+(?:type\s+)?(?:\{[^}]*\b(?:TaskStore|FileTaskStore|MemoryTaskStore)\b[^}]*\}|\*\s+as\s+\w+)\s+from\s+['"][^'"]*TaskStore['"]/;
const LIFECYCLE_RE = /\b(?:SessionEnd|session\.after|turn\.after|AfterTurn|AfterSession|onSessionEnd|onTurnEnd|afterSession|afterTurn)\b/;
const KNOWLEDGE_WRITE_CALL_RE = /\b(?:knowledgeWriteService|[A-Za-z0-9_]*[Kk]nowledgeWriteService)\s*\.\s*[A-Za-z0-9_]+\s*\(|\bnew\s+KnowledgeWriteService\b|\bknowledge:(?:write|promote|update|deprecate)\b|\bthis\.write\s*\(/;
const HUMAN_APPROVED_IPC_RE = /ipcMain\.handle\(\s*['"]knowledge:(?:write|promote|update|deprecate)['"]/;
const APPROVAL_TOKEN_RE = /\bapprovalToken\b/;
const HUMAN_CONFIRM_RE = /\b(?:explicitHumanConfirmation|humanConfirmation|requireHuman(?:Approval|Confirmation))\b/;

function isProductSource(posixPath) {
  if (!posixPath.startsWith('src/')) return false;
  if (posixPath.startsWith('src/main/testing/')) return false;
  if (posixPath.includes('/__fixtures__/') || posixPath.includes('/fixtures/')) return false;
  return true;
}

function isCanonicalTaskStorePath(posixPath) {
  return posixPath === 'src/main/agent-runtime/tasks' || posixPath.startsWith(CANONICAL_TASKS_DIR);
}

export function isExtraTaskStoreImplementation(source, posixPath) {
  if (isCanonicalTaskStorePath(posixPath)) return false;
  if (TASK_STORE_IMPLEMENTS_RE.test(source) || TASK_STORE_EXTENDS_RE.test(source)) return true;
  if (TASK_STORE_CLASS_RE.test(source) && (TASK_STORE_IMPORT_RE.test(source) || /\binterface\s+TaskStore\b/.test(source))) {
    return true;
  }
  return false;
}

function knowledgeWriteTokenPattern(token) {
  return new RegExp(
    `(?:^|[^A-Za-z0-9_])(?:['"]${token}['"]|${token}\\s*:)`,
  );
}

export function hasForbiddenKnowledgeWriteToken(source) {
  return FORBIDDEN_KNOWLEDGE_WRITE_TOKENS.some((token) => knowledgeWriteTokenPattern(token).test(source));
}

export function hasLifecycleKnowledgeWrite(source) {
  if (!KNOWLEDGE_WRITE_CALL_RE.test(source)) return false;
  const matches = [...source.matchAll(new RegExp(LIFECYCLE_RE.source, 'g'))];
  return matches.some((match) => {
    const start = Math.max(0, match.index - 80);
    const end = Math.min(source.length, match.index + 1200);
    return KNOWLEDGE_WRITE_CALL_RE.test(source.slice(start, end));
  });
}

function isLegitimateRdxCliSurface(posixPath) {
  return /RdxCliInvokerSettings|RdxShellAction/.test(posixPath);
}

export function hasRdxMcpRegistration(source) {
  return (
    /mcpServers?\s*[:=][\s\S]{0,500}(?:name|id|command|descriptorId)\s*:\s*['"][^'"]*rdx/i.test(source)
    || /(?:name|id|descriptorId)\s*:\s*['"]rdx(?:-mcp)?['"][\s\S]{0,240}(?:command|transport|mcpServers?|url)/i.test(source)
    || /AgentRuntimeMcpDescriptor[\s\S]{0,240}['"]rdx/i.test(source)
    || /createMcpServer\([^)]*rdx/i.test(source)
    || /mcp__rdx__/i.test(source)
  );
}

export function hasRdAgentToolRegistration(source, posixPath) {
  const inCatalog = (
    posixPath.endsWith('agentToolTokens.ts')
    || posixPath.endsWith('agentWorkbenchCatalog.ts')
    || posixPath.endsWith('workProcessToolCatalog.ts')
    || posixPath.endsWith('RuntimeToolAssembly.ts')
    || posixPath.startsWith('src/main/agent-runtime/tools/')
  );
  if (inCatalog && /['"]rd\.[A-Za-z0-9_.]+['"]/.test(source)) {
    return /BUILTIN_AGENT_TOOL_IDS|AGENT_WORKBENCH_TOOL_CATALOG|id:\s*['"]rd\.|name:\s*['"]rd\./.test(source);
  }
  return (
    /(?:new\s+AgentTool|create(?:Builtin)?(?:Agent)?Tool|register(?:ed)?Tool)\s*\([\s\S]{0,400}(?:name|id)\s*:\s*['"]rd\./.test(source)
    || /(?:name|id)\s*:\s*['"]rd\.[A-Za-z0-9_.]+['"][\s\S]{0,200}(?:inputSchema|permission|execute\s*\(|spec\s*:|approvalRequired|resultSummary)/.test(source)
  );
}

export function collectHardForbidViolations(repoRoot) {
  const violations = [];
  const srcRoot = path.join(repoRoot, 'src');
  const files = walkFiles(srcRoot, { includeTests: false });

  for (const absolute of files) {
    const posixPath = relativePosix(repoRoot, absolute);
    if (!isProductSource(posixPath)) continue;
    const source = readFileSync(absolute, 'utf8');

    if (isExtraTaskStoreImplementation(source, posixPath)) {
      violations.push({
        id: 'hard.task-store.extra',
        file: posixPath,
        pattern: 'implements TaskStore | extends *TaskStore | class *TaskStore + import/interface',
        note: 'TaskStore implementations are only allowed under src/main/agent-runtime/tasks',
      });
    }

    if (/(?:^|\/)InvestigationGraph(?:Service)?\.ts$/.test(posixPath) || GRAPH_CLASS_RE.test(source)) {
      violations.push({
        id: 'hard.investigation-graph',
        file: posixPath,
        pattern: 'InvestigationGraph',
        note: 'platform InvestigationGraph directory/service is forbidden',
      });
    }

    const cliSurface = isLegitimateRdxCliSurface(posixPath);
    if (hasRdxMcpRegistration(source) || (!cliSurface && hasRdAgentToolRegistration(source, posixPath))) {
      violations.push({
        id: 'hard.rdx-mcp-or-rd-tools',
        file: posixPath,
        pattern: 'RDX MCP registration or rd.* AgentTool/catalog registration',
        note: 'RDX MCP or rd.* Agent tool schema registration is forbidden',
      });
    }

    if (hasForbiddenKnowledgeWriteToken(source)) {
      violations.push({
        id: 'hard.knowledge.autonomy-tool',
        file: posixPath,
        pattern: FORBIDDEN_KNOWLEDGE_WRITE_TOKENS.join('|'),
        note: 'Agent-autonomous knowledge write/promote/update/deprecate tokens are forbidden',
      });
    }

    if (HUMAN_APPROVED_IPC_RE.test(source) && !(APPROVAL_TOKEN_RE.test(source) && HUMAN_CONFIRM_RE.test(source))) {
      violations.push({
        id: 'hard.knowledge.write-ipc-unapproved',
        file: posixPath,
        pattern: 'knowledge write IPC without approvalToken and explicit human confirmation',
        note: 'Knowledge write IPC must require approvalToken and explicit human confirmation',
      });
    }

    if (hasLifecycleKnowledgeWrite(source)) {
      violations.push({
        id: 'hard.knowledge.session-end-write',
        file: posixPath,
        pattern: 'lifecycle callback + KnowledgeWriteService/write API',
        note: 'lifecycle automatic Knowledge writes are forbidden',
      });
    }
  }

  const graphDirs = ['src/main/InvestigationGraph', 'src/main/investigation/InvestigationGraph', 'src/shared/InvestigationGraph'];
  for (const relative of graphDirs) {
    const absolute = resolveRulePath(repoRoot, relative);
    if (existsSync(absolute) && statSync(absolute).isDirectory()) {
      violations.push({
        id: 'hard.investigation-graph',
        file: relative,
        pattern: 'InvestigationGraph/',
        note: 'platform InvestigationGraph directory is forbidden',
      });
    }
  }

  const queryPath = resolveRulePath(repoRoot, 'src/main/knowledge/KnowledgeQueryService.ts');
  const browsePath = resolveRulePath(repoRoot, 'src/main/runtime/KnowledgeBrowseService.ts');
  if (existsSync(queryPath) && existsSync(browsePath)) {
    violations.push({
      id: 'hard.knowledge.dual-resolver',
      file: 'src/main/knowledge/KnowledgeQueryService.ts',
      pattern: 'KnowledgeQueryService + KnowledgeBrowseService',
      note: 'Query and Browse resolvers must not coexist; delete Browse when Query lands',
    });
  }

  return violations;
}

const TEST_CALLEES = new Set(['it', 'test']);
const SUITE_CALLEES = new Set(['it', 'test', 'describe']);
const FORBIDDEN_TEST_MODIFIERS = new Set(['skip', 'todo', 'only']);

function caseLabel(required) {
  return required.title || required.fullName || `cases[${required.index}]`;
}

function staticTitle(required) {
  if (required.title) return required.title;
  const fullName = required.fullName || '';
  const parts = fullName.split(/\s+/);
  return parts[parts.length - 1] || fullName;
}

function parseContractSource(source, fileName = 'contract.test.ts') {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function unwrapExpression(statement) {
  return ts.isExpressionStatement(statement) ? statement.expression : null;
}

function readCallIdentity(expr) {
  if (!expr || !ts.isCallExpression(expr)) return null;
  if (ts.isIdentifier(expr.expression)) {
    return { root: expr.expression.text, modifiers: [] };
  }
  if (ts.isPropertyAccessExpression(expr.expression) && ts.isIdentifier(expr.expression.expression)) {
    return { root: expr.expression.expression.text, modifiers: [expr.expression.name.text] };
  }
  return null;
}

function literalTitle(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function callbackOf(call) {
  for (const arg of call.arguments.slice(1)) {
    if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) return arg;
  }
  return null;
}

function callbackStatements(fn) {
  if (!fn?.body) return [];
  if (ts.isBlock(fn.body)) return [...fn.body.statements];
  return [];
}

function collectTopLevelTests(sourceFile) {
  const tests = [];
  const visitStatements = (statements) => {
    for (const statement of statements) {
      const expr = unwrapExpression(statement);
      if (!expr || !ts.isCallExpression(expr)) continue;
      const identity = readCallIdentity(expr);
      if (!identity) continue;
      if (identity.root === 'describe' && identity.modifiers.length === 0) {
        const nested = callbackOf(expr);
        if (nested) visitStatements(callbackStatements(nested));
        continue;
      }
      if (TEST_CALLEES.has(identity.root)) {
        tests.push({
          title: literalTitle(expr.arguments[0]),
          modifiers: identity.modifiers,
          callback: callbackOf(expr),
        });
      }
    }
  };
  visitStatements(sourceFile.statements);
  return tests;
}

function collectForbiddenModifiers(node, errors) {
  if (ts.isCallExpression(node)) {
    const identity = readCallIdentity(node);
    if (identity && SUITE_CALLEES.has(identity.root) && identity.modifiers.some((mod) => FORBIDDEN_TEST_MODIFIERS.has(mod))) {
      errors.push(`contract suite must not contain .skip( / .todo( / .only(`);
    }
  }
  ts.forEachChild(node, (child) => collectForbiddenModifiers(child, errors));
}

function expectGuardInExpression(expr) {
  if (!expr || !ts.isCallExpression(expr)) return null;
  if (!ts.isPropertyAccessExpression(expr.expression)) return null;
  if (!ts.isIdentifier(expr.expression.expression) || expr.expression.expression.text !== 'expect') return null;
  const method = expr.expression.name.text;
  if (method === 'hasAssertions') return { kind: 'hasAssertions' };
  if (method === 'assertions') {
    const arg = expr.arguments[0];
    if (arg && ts.isNumericLiteral(arg)) {
      return { kind: Number(arg.text) > 0 ? 'assertions' : 'assertions-zero', n: Number(arg.text) };
    }
  }
  return null;
}

function inspectFirstDirectGuard(callback, title) {
  if (!callback || !(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
    return `contract case ${title} callback must be a function literal`;
  }
  if (!ts.isBlock(callback.body)) {
    return `contract case ${title} callback must be a block body; expression bodies are not accepted`;
  }
  const first = callback.body.statements[0];
  if (!first) {
    return `contract case ${title} must call expect.hasAssertions() or expect.assertions(n>0) as its first direct statement`;
  }
  if (!ts.isExpressionStatement(first)) {
    return `contract case ${title} first direct statement must be expect.hasAssertions() or expect.assertions(n>0); nested/control-flow guards are rejected`;
  }
  const guard = expectGuardInExpression(first.expression);
  if (!guard) {
    return `contract case ${title} first direct statement must be expect.hasAssertions() or expect.assertions(n>0)`;
  }
  if (guard.kind === 'assertions-zero') {
    return `contract case ${title} rejects expect.assertions(0)`;
  }
  return null;
}

export function inspectContractSuiteSource(source, requiredCases, fileName = 'contract.test.ts') {
  const errors = [];
  const sourceFile = parseContractSource(source, fileName);
  collectForbiddenModifiers(sourceFile, errors);
  const tests = collectTopLevelTests(sourceFile);
  const titles = tests.map((entry) => entry.title).filter((title) => typeof title === 'string');
  const seen = new Set();
  for (const title of titles) {
    if (seen.has(title)) errors.push(`contract suite has duplicate title ${title}`);
    seen.add(title);
  }
  for (const required of requiredCases) {
    const title = staticTitle(required);
    const matches = tests.filter((entry) => entry.title === title);
    if (matches.length === 0) {
      errors.push(`contract suite missing exact test title ${title}`);
      continue;
    }
    if (matches.length > 1) {
      errors.push(`contract case ${title} is duplicated`);
      continue;
    }
    const test = matches[0];
    if (test.modifiers.some((mod) => FORBIDDEN_TEST_MODIFIERS.has(mod))) {
      errors.push(`contract case ${title} uses skip/todo/only`);
      continue;
    }
    const guardError = inspectFirstDirectGuard(test.callback, title);
    if (guardError) errors.push(guardError);
  }
  return [...new Set(errors)];
}

export function matchVitestCase(result, required) {
  const title = result.title || '';
  const fullName = result.fullName || '';
  if (required.fullName && required.title) return fullName === required.fullName && title === required.title;
  if (required.fullName) return fullName === required.fullName;
  return title === required.title;
}

export function summarizeVitestJson(report, requiredCases, limits = {}) {
  const errors = [];
  const assertionResults = (report.testResults ?? []).flatMap((suite) => suite.assertionResults ?? []);
  for (const required of requiredCases) {
    const matches = assertionResults.filter((result) => matchVitestCase(result, required));
    if (matches.length === 0) {
      errors.push(`vitest JSON missing exact case ${caseLabel(required)}`);
      continue;
    }
    const result = matches[0];
    if (result.status !== 'passed') {
      errors.push(`vitest case ${caseLabel(required)} status=${result.status} (must be passed)`);
    }
  }
  const failed = report.numFailedTests ?? assertionResults.filter((item) => item.status === 'failed').length;
  const skipped = report.numPendingTests ?? assertionResults.filter((item) => item.status === 'skipped' || item.status === 'pending').length;
  const todo = report.numTodoTests ?? assertionResults.filter((item) => item.status === 'todo').length;
  if (failed !== 0) errors.push(`vitest failed=${failed} (must be 0)`);
  if (skipped !== 0) errors.push(`vitest skipped/pending=${skipped} (must be 0)`);
  if (todo !== 0) errors.push(`vitest todo=${todo} (must be 0)`);
  const minTests = limits.minTests ?? requiredCases.length;
  const total = report.numTotalTests ?? assertionResults.length;
  if (total < minTests) errors.push(`vitest suite count ${total} < minTests ${minTests}`);
  return errors;
}

export function runContractSuite(rule, repoRoot) {
  const suitePath = resolveRulePath(repoRoot, rule.file);
  const requiredCases = normalizeRequiredCases(rule);
  const minTests = rule.minTests ?? requiredCases.length;
  const minAssertions = rule.minAssertions ?? requiredCases.reduce((sum, entry) => sum + entry.minAssertions, 0);
  const source = readFileSync(suitePath, 'utf8');
  const sourceErrors = inspectContractSuiteSource(source, requiredCases, rule.file);
  if (sourceErrors.length > 0) {
    return sourceErrors.map((message) => `${rule.id}: ${message}`);
  }

  const reportPath = path.join(os.tmpdir(), `rdc-system-debt-${randomBytes(8).toString('hex')}.json`);
  try {
    const spawned = spawnVitest(
      ['run', toPosix(rule.file), '--reporter=json', `--outputFile=${reportPath}`],
      { cwd: repoRoot },
    );
    if (spawned.status !== 0 && !existsSync(reportPath)) {
      return [`${rule.id}: vitest hard fail (exit ${spawned.status}): ${(spawned.stderr || spawned.stdout || '').trim()}`];
    }
    if (!existsSync(reportPath)) {
      return [`${rule.id}: vitest JSON report missing at ${toPosix(reportPath)}`];
    }
    let report;
    try {
      report = JSON.parse(readFileSync(reportPath, 'utf8'));
    } catch (error) {
      return [`${rule.id}: vitest JSON report unreadable: ${error instanceof Error ? error.message : String(error)}`];
    }
    const reportErrors = summarizeVitestJson(report, requiredCases, { minTests, minAssertions });
    if (spawned.status !== 0) {
      reportErrors.unshift(`${rule.id}: vitest exited ${spawned.status}`);
    }
    return reportErrors.map((message) => (message.startsWith(rule.id) ? message : `${rule.id}: ${message}`));
  } finally {
    try {
      unlinkSync(reportPath);
    } catch {
      // tmp report is best-effort
    }
  }
}

function resolveVitestEntry(cwd) {
  const candidates = [
    path.join(cwd, 'node_modules', 'vitest', 'vitest.mjs'),
    path.join(cwd, 'node_modules', 'vitest', 'dist', 'cli.js'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

export function spawnVitest(args, { cwd } = {}) {
  const root = cwd || defaultRepoRoot();
  const entry = resolveVitestEntry(root);
  if (entry) {
    return spawnSync(process.execPath, [entry, ...args], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    });
  }
  return spawnSync(
    process.platform === 'win32' ? 'corepack.cmd' : 'corepack',
    ['pnpm', 'exec', 'vitest', ...args],
    {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      shell: process.platform === 'win32',
    },
  );
}

export function spawnVitestOnFile(suitePath, { cwd, reportPath } = {}) {
  const args = ['run', suitePath, '--reporter=json', '--no-config'];
  if (reportPath) args.push(`--outputFile=${reportPath}`);
  return spawnVitest(args, { cwd: cwd || defaultRepoRoot() });
}

export function runSystemDebtCheck(options) {
  const name = options.name;
  const repoRoot = options.repoRoot || defaultRepoRoot();
  const argv = options.argv || process.argv.slice(2);
  const env = options.env || process.env;
  const registry = options.registry;
  const debtRelativePath = toPosix(options.debtRelativePath);
  const errors = [];
  const notes = [];

  const registryErrors = validateRegistry(registry);
  errors.push(...registryErrors);

  if (argv.includes('--emit-measured')) {
    const measured = evaluateRegistry(registry, repoRoot);
    const debt = formatDebt(measured.map((hit) => hit.id));
    return { ok: errors.length === 0, errors, notes, measured, debt, emitted: true };
  }

  if (!options.skipHardForbids) {
    for (const violation of collectHardForbidViolations(repoRoot)) {
      errors.push(`HARD FAIL ${violation.id} file=${violation.file} pattern=${violation.pattern} (${violation.note})`);
    }
  }

  const measured = evaluateRegistry(registry, repoRoot);
  for (const rule of registry) {
    if (rule.probe !== 'contract-suite') continue;
    const suitePath = resolveRulePath(repoRoot, rule.file);
    if (existsSync(suitePath) && statSync(suitePath).isFile()) {
      errors.push(...runContractSuite(rule, repoRoot));
    }
  }

  let debt;
  try {
    debt = options.debt
      || readDebtFile(options.debtFile || resolveRulePath(repoRoot, debtRelativePath), `${name} debt`);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return { ok: false, errors, notes, measured, debt: null };
  }

  errors.push(...compareMeasuredToDebt(measured, debt, registry));

  const baseRef = options.baseRef ?? resolveBaseRef(argv, env);
  const classification = classifyBaseRef(baseRef, { ci: isCiEnv(env) });
  if (classification.mode === 'ci-missing') {
    errors.push(classification.message);
  } else if (classification.mode === 'local-skip') {
    notes.push(classification.message);
  } else if (classification.mode === 'wave0-init') {
    notes.push(classification.message);
  } else if (!options.skipHistorical) {
    try {
      const historical = options.historical
        || loadHistoricalDebt(options.gitRepoRoot || repoRoot, baseRef, debtRelativePath);
      if (historical.mode === 'wave0-init') {
        notes.push(historical.message);
      } else {
        errors.push(...compareHistoricalDebt(debt, historical.debt));
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return { ok: errors.length === 0, errors, notes, measured, debt, baseRef, classification };
}

export function printCheckResult(name, result) {
  for (const note of result.notes) {
    console.log(`[${name}] ${note}`);
  }
  if (result.emitted) {
    console.log(JSON.stringify(result.debt, null, 2));
    return result.ok ? 0 : 1;
  }
  if (!result.ok) {
    for (const error of result.errors) {
      console.error(`[${name}] ${error}`);
    }
    return 1;
  }
  console.log(`[${name}] OK hits=${result.debt?.maxHits ?? 0} ids=${(result.debt?.ids ?? []).join(',')}`);
  return 0;
}

function git(repo, args, extraEnv = {}) {
  const result = spawnSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'ratchet-self-test',
      GIT_AUTHOR_EMAIL: 'ratchet@example.test',
      GIT_COMMITTER_NAME: 'ratchet-self-test',
      GIT_COMMITTER_EMAIL: 'ratchet@example.test',
      ...extraEnv,
    },
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function fixtureRegistry() {
  return [
    {
      id: 'demo.missing.target',
      kind: 'missing',
      file: 'src/target.ts',
      pattern: 'export const ready = true',
      probe: 'source-pattern',
      note: 'posix fixture target',
    },
    {
      id: 'demo.forbidden.legacy',
      kind: 'forbidden',
      file: 'src/legacy.ts',
      pattern: 'LEGACY_MARK',
      probe: 'source-pattern',
      note: 'posix fixture legacy',
    },
  ];
}

function runFixtureCase(label, execute) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rdc-system-debt-'));
  try {
    execute(dir);
    return { label, ok: true };
  } catch (error) {
    return { label, ok: false, message: error instanceof Error ? error.message : String(error) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function expectFail(result, fragment) {
  if (result.ok) throw new Error('expected failure');
  if (fragment && !result.errors.some((error) => error.includes(fragment))) {
    throw new Error(`expected error containing ${fragment}, got: ${result.errors.join(' | ')}`);
  }
}

function expectOk(result) {
  if (!result.ok) throw new Error(result.errors.join(' | '));
}

export function runSelfTest() {
  const cases = [];

  cases.push(runFixtureCase('exact', (dir) => {
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'legacy.ts'), 'export const LEGACY_MARK = 1;\n', 'utf8');
    const registry = fixtureRegistry();
    const measured = evaluateRegistry(registry, dir);
    const debt = formatDebt(measured.map((hit) => hit.id));
    writeJson(path.join(dir, 'debt.json'), debt);
    expectOk(runSystemDebtCheck({
      name: 'self-test',
      repoRoot: dir,
      registry,
      debtFile: path.join(dir, 'debt.json'),
      debtRelativePath: 'debt.json',
      skipHardForbids: true,
      skipHistorical: true,
      env: {},
      argv: [],
    }));
    if (measured.some((hit) => hit.file.includes('\\'))) {
      throw new Error('measured file paths must be posix');
    }
  }));

  cases.push(runFixtureCase('new-id', (dir) => {
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'legacy.ts'), 'export const LEGACY_MARK = 1;\n', 'utf8');
    const registry = fixtureRegistry();
    const debt = formatDebt(['demo.forbidden.legacy']);
    writeJson(path.join(dir, 'debt.json'), debt);
    expectFail(runSystemDebtCheck({
      name: 'self-test',
      repoRoot: dir,
      registry,
      debtFile: path.join(dir, 'debt.json'),
      debtRelativePath: 'debt.json',
      skipHardForbids: true,
      skipHistorical: true,
      env: {},
      argv: [],
    }), 'new hit');
  }));

  cases.push(runFixtureCase('stale', (dir) => {
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'legacy.ts'), 'export const LEGACY_MARK = 1;\n', 'utf8');
    writeFileSync(path.join(dir, 'src', 'target.ts'), 'export const ready = true;\n', 'utf8');
    const registry = fixtureRegistry();
    const debt = formatDebt(['demo.forbidden.legacy', 'demo.missing.target']);
    writeJson(path.join(dir, 'debt.json'), debt);
    expectFail(runSystemDebtCheck({
      name: 'self-test',
      repoRoot: dir,
      registry,
      debtFile: path.join(dir, 'debt.json'),
      debtRelativePath: 'debt.json',
      skipHardForbids: true,
      skipHistorical: true,
      env: {},
      argv: [],
    }), 'stale debt id');
  }));

  cases.push(runFixtureCase('maxHits', (dir) => {
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'legacy.ts'), 'export const LEGACY_MARK = 1;\n', 'utf8');
    const registry = fixtureRegistry();
    writeJson(path.join(dir, 'debt.json'), {
      schemaVersion: 1,
      waveClearBy: 6,
      maxHits: 3,
      ids: ['demo.forbidden.legacy', 'demo.missing.target'],
    });
    expectFail(runSystemDebtCheck({
      name: 'self-test',
      repoRoot: dir,
      registry,
      debtFile: path.join(dir, 'debt.json'),
      debtRelativePath: 'debt.json',
      skipHardForbids: true,
      skipHistorical: true,
      env: {},
      argv: [],
    }), 'ids.length');
  }));

  cases.push(runFixtureCase('posix', (dir) => {
    mkdirSync(path.join(dir, 'src', 'nested'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'nested', 'file.ts'), 'export const ready = true;\n', 'utf8');
    const registry = [{
      id: 'demo.missing.nested',
      kind: 'missing',
      file: 'src\\nested\\file.ts',
      pattern: 'export const ready = true',
      probe: 'source-pattern',
      note: 'backslash file must normalize',
    }];
    const measured = evaluateRegistry(registry, dir);
    if (measured.length !== 0) throw new Error('posix-normalized existing file must satisfy missing rule');
    if (evaluateRule(registry[0], dir).file !== 'src/nested/file.ts') {
      throw new Error(`expected posix file, got ${evaluateRule(registry[0], dir).file}`);
    }
  }));

  cases.push(runFixtureCase('base-init', (dir) => {
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'legacy.ts'), 'export const LEGACY_MARK = 1;\n', 'utf8');
    writeJson(path.join(dir, 'debt.json'), formatDebt(['demo.forbidden.legacy', 'demo.missing.target']));
    git(dir, ['init']);
    git(dir, ['add', 'src/legacy.ts']);
    git(dir, ['commit', '-m', 'base without debt']);
    const base = git(dir, ['rev-parse', 'HEAD']);
    const registry = fixtureRegistry();
    expectOk(runSystemDebtCheck({
      name: 'self-test',
      repoRoot: dir,
      gitRepoRoot: dir,
      registry,
      debtFile: path.join(dir, 'debt.json'),
      debtRelativePath: 'debt.json',
      skipHardForbids: true,
      baseRef: base,
      env: { CI: 'true' },
      argv: ['--base-ref', base],
    }));
  }));

  cases.push(runFixtureCase('debt-extra-keys', (dir) => {
    try {
      parseDebtDocument({
        schemaVersion: 1,
        waveClearBy: 6,
        maxHits: 1,
        ids: ['demo.forbidden.legacy'],
        note: 'extra',
      }, 'debt');
      throw new Error('expected extra key to fail');
    } catch (error) {
      if (!String(error.message).includes('keys must be exactly')) throw error;
    }
  }));

  cases.push(runFixtureCase('contract-substring', () => {
    const source = "it('knowledge.contract.tools.registered-permission-deferred EXTRA', () => { expect.hasAssertions(); expect(true).toBe(true); });";
    const errors = inspectContractSuiteSource(source, [{ title: 'knowledge.contract.tools.registered-permission-deferred', minAssertions: 1 }]);
    if (!errors.some((error) => error.includes('missing exact test title'))) {
      throw new Error(`expected missing exact title, got ${errors.join(' | ')}`);
    }
  }));

  cases.push(runFixtureCase('contract-assertions-zero', () => {
    const source = "it('demo.case', () => { expect.assertions(0); });";
    const errors = inspectContractSuiteSource(source, [{ title: 'demo.case', minAssertions: 1 }]);
    if (!errors.some((error) => error.includes('assertions(0)'))) {
      throw new Error(`expected assertions(0) reject, got ${errors.join(' | ')}`);
    }
  }));

  cases.push(runFixtureCase('contract-no-assert', () => {
    const source = "it('demo.case', () => { expect(true).toBe(true); });";
    const errors = inspectContractSuiteSource(source, [{ title: 'demo.case', minAssertions: 1 }]);
    if (!errors.some((error) => error.includes('hasAssertions') || error.includes('assertions(n>0)'))) {
      throw new Error(`expected no-assert reject, got ${errors.join(' | ')}`);
    }
  }));

  cases.push(runFixtureCase('contract-skip', () => {
    const source = "it.skip('demo.case', () => { expect.hasAssertions(); expect(1).toBe(1); });";
    const errors = inspectContractSuiteSource(source, [{ title: 'demo.case', minAssertions: 1 }]);
    if (!errors.some((error) => /skip|todo|only/.test(error))) {
      throw new Error(`expected skip reject, got ${errors.join(' | ')}`);
    }
  }));

  cases.push(runFixtureCase('contract-missing-case', () => {
    const source = "it('other.case', () => { expect.hasAssertions(); expect(1).toBe(1); });";
    const errors = inspectContractSuiteSource(source, [{ title: 'demo.case', minAssertions: 1 }]);
    if (!errors.some((error) => error.includes('missing exact test title'))) {
      throw new Error(`expected missing case, got ${errors.join(' | ')}`);
    }
  }));

  cases.push(runFixtureCase('contract-comment-spoof', () => {
    const source = [
      "// it('demo.case', () => { expect.hasAssertions(); expect(1).toBe(1); });",
      "it('demo.case', () => {});",
    ].join('\n');
    const errors = inspectContractSuiteSource(source, [{ title: 'demo.case', minAssertions: 1 }]);
    if (!errors.some((error) => error.includes('hasAssertions') || error.includes('assertions(n>0)'))) {
      throw new Error(`expected comment spoof + empty case to fail, got ${errors.join(' | ')}`);
    }
  }));

  cases.push(runFixtureCase('contract-duplicate-title', () => {
    const source = [
      "it('demo.case', () => { expect.hasAssertions(); expect(1).toBe(1); });",
      "it('demo.case', () => { expect.hasAssertions(); expect(2).toBe(2); });",
    ].join('\n');
    const errors = inspectContractSuiteSource(source, [{ title: 'demo.case', minAssertions: 1 }]);
    if (!errors.some((error) => /duplicate/i.test(error))) {
      throw new Error(`expected duplicate title fail, got ${errors.join(' | ')}`);
    }
  }));

  cases.push(runFixtureCase('contract-expression-body', () => {
    const source = "it('demo.case', () => expect.hasAssertions());";
    const errors = inspectContractSuiteSource(source, [{ title: 'demo.case', minAssertions: 1 }]);
    if (!errors.some((error) => /block body|expression bodies/.test(error))) {
      throw new Error(`expected expression-body callback to fail, got ${errors.join(' | ')}`);
    }
  }));

  cases.push(runFixtureCase('contract-non-literal-callback', () => {
    const source = "const cb = () => { expect.hasAssertions(); expect(1).toBe(1); };\nit('demo.case', cb);";
    const errors = inspectContractSuiteSource(source, [{ title: 'demo.case', minAssertions: 1 }]);
    if (!errors.some((error) => /function literal/.test(error))) {
      throw new Error(`expected non-literal callback to fail, got ${errors.join(' | ')}`);
    }
  }));

  cases.push(runFixtureCase('contract-if-false-guard', () => {
    const source = "it('demo.case', () => { if (false) expect.hasAssertions(); });";
    const errors = inspectContractSuiteSource(source, [{ title: 'demo.case', minAssertions: 1 }]);
    if (!errors.some((error) => /first direct statement|nested|control-flow/.test(error))) {
      throw new Error(`expected if(false) guard to fail, got ${errors.join(' | ')}`);
    }
  }));

  cases.push(runFixtureCase('contract-return-then-guard', () => {
    const source = "it('demo.case', () => { return; expect.hasAssertions(); });";
    const errors = inspectContractSuiteSource(source, [{ title: 'demo.case', minAssertions: 1 }]);
    if (!errors.some((error) => /first direct statement|nested|control-flow/.test(error))) {
      throw new Error(`expected return-then-guard to fail, got ${errors.join(' | ')}`);
    }
  }));

  cases.push(runFixtureCase('contract-hasassertions-only-runtime', (dir) => {
    const suite = path.join(dir, 'empty-guard.test.ts');
    writeFileSync(suite, [
      "import { expect, it } from 'vitest';",
      "it('demo.case', () => {",
      '  expect.hasAssertions();',
      '});',
      '',
    ].join('\n'), 'utf8');
    const staticErrors = inspectContractSuiteSource(readFileSync(suite, 'utf8'), [{ title: 'demo.case', minAssertions: 1 }], suite);
    if (staticErrors.length > 0) throw new Error(`static inspect should pass: ${staticErrors.join(' | ')}`);
    const spawned = spawnVitestOnFile(suite);
    if (spawned.status === 0) {
      throw new Error('vitest should fail when the callback only calls hasAssertions()');
    }
  }));

  cases.push(runFixtureCase('vitest-json-substring', () => {
    const errors = summarizeVitestJson({
      numTotalTests: 1,
      numFailedTests: 0,
      numPendingTests: 0,
      numTodoTests: 0,
      testResults: [{
        assertionResults: [{
          title: 'knowledge.contract.tools.registered-permission-deferred EXTRA',
          fullName: 'suite knowledge.contract.tools.registered-permission-deferred EXTRA',
          status: 'passed',
          numPassingAsserts: 2,
        }],
      }],
    }, [{ title: 'knowledge.contract.tools.registered-permission-deferred', minAssertions: 1 }]);
    if (!errors.some((error) => error.includes('missing exact case'))) {
      throw new Error(`expected JSON substring reject, got ${errors.join(' | ')}`);
    }
  }));

  cases.push(runFixtureCase('profile-ceiling', (dir) => {
    const file = path.join(dir, 'resources', 'agent-runtime', 'agents', 'general.agent.md');
    mkdirSync(path.dirname(file), { recursive: true });
    const rule = {
      id: 'knowledge.missing.profile.ceiling.general',
      kind: 'missing',
      file: 'resources/agent-runtime/agents/general.agent.md',
      pattern: 'knowledge',
      probe: 'profile-knowledge-ceiling',
      note: 'ceiling',
    };
    writeFileSync(file, '---\nid: general\ntools: [knowledge_browse]\n---\n', 'utf8');
    if (!evaluateRule(rule, dir).hit) throw new Error('single knowledge_* must not clear ceiling debt');
    writeFileSync(file, '---\nid: general\ntools: [read, knowledge, shell]\n---\n', 'utf8');
    if (evaluateRule(rule, dir).hit) throw new Error('canonical knowledge token must clear ceiling debt');
    writeFileSync(file, '---\nid: general\ntools: [knowledge_browse, knowledge_search, knowledge_read, knowledge_compile, knowledge_candidate_create]\n---\n', 'utf8');
    if (evaluateRule(rule, dir).hit) throw new Error('complete five-tool expansion must clear ceiling debt');
  }));

  cases.push(runFixtureCase('hard-taskstore-rename', (dir) => {
    mkdirSync(path.join(dir, 'src', 'main', 'alt'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'main', 'alt', 'HiddenStore.ts'), `
import type { TaskStore } from '../agent-runtime/tasks/TaskStore';
export class HiddenStore implements TaskStore {
  async loadTask() { return null; }
}
`, 'utf8');
    const violations = collectHardForbidViolations(dir);
    if (!violations.some((item) => item.id === 'hard.task-store.extra')) {
      throw new Error('renamed TaskStore implementor must fail');
    }
  }));

  cases.push(runFixtureCase('hard-taskstore-type-ref', (dir) => {
    mkdirSync(path.join(dir, 'src', 'main', 'alt'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'main', 'alt', 'UsesStore.ts'), `
import type { TaskStore } from '../agent-runtime/tasks/TaskStore';
export function read(store: TaskStore) { return store; }
const taskStore = null;
`, 'utf8');
    const violations = collectHardForbidViolations(dir);
    if (violations.some((item) => item.id === 'hard.task-store.extra')) {
      throw new Error('type/variable TaskStore references must not fail');
    }
  }));

  cases.push(runFixtureCase('hard-rdx-settings-mcp', (dir) => {
    mkdirSync(path.join(dir, 'src', 'renderer', 'features', 'settings'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'renderer', 'features', 'settings', 'HiddenRdxMcp.ts'), `
export const mcpServers = [{ name: 'rdx', command: 'rdx-mcp', transport: 'stdio' }];
`, 'utf8');
    const violations = collectHardForbidViolations(dir);
    if (!violations.some((item) => item.id === 'hard.rdx-mcp-or-rd-tools')) {
      throw new Error('RDX MCP hidden in settings must fail');
    }
  }));

  cases.push(runFixtureCase('hard-rdx-plain-name', (dir) => {
    mkdirSync(path.join(dir, 'src', 'main'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'main', 'plain.ts'), `export const example = { name: 'rd.foo', label: 'not a tool' };\n`, 'utf8');
    const violations = collectHardForbidViolations(dir);
    if (violations.some((item) => item.id === 'hard.rdx-mcp-or-rd-tools')) {
      throw new Error('ordinary name rd.foo must not fail');
    }
  }));

  cases.push(runFixtureCase('hard-rdx-agent-tool', (dir) => {
    mkdirSync(path.join(dir, 'src', 'shared', 'constants'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'shared', 'constants', 'agentToolTokens.ts'), `
export const BUILTIN_AGENT_TOOL_IDS = ['read_file', 'rd.foo'];
`, 'utf8');
    const violations = collectHardForbidViolations(dir);
    if (!violations.some((item) => item.id === 'hard.rdx-mcp-or-rd-tools')) {
      throw new Error('builtin AgentTool rd.foo must fail');
    }
  }));

  cases.push(runFixtureCase('hard-knowledge-write-token', (dir) => {
    mkdirSync(path.join(dir, 'src', 'shared', 'constants'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'shared', 'constants', 'agentToolTokens.ts'), `
export const CANONICAL_TOOL_TOKEN_EXPANSIONS = { knowledge_write: ['knowledge_write'] };
`, 'utf8');
    const violations = collectHardForbidViolations(dir);
    if (!violations.some((item) => item.id === 'hard.knowledge.autonomy-tool')) {
      throw new Error('knowledge_write token must fail');
    }
  }));

  cases.push(runFixtureCase('hard-knowledge-write-canonical-lifecycle', (dir) => {
    mkdirSync(path.join(dir, 'src', 'main', 'knowledge'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'main', 'knowledge', 'KnowledgeWriteService.ts'), `
export class KnowledgeWriteService {
  onSessionEnd() {
    this.write({ title: 'auto' });
  }
  write(input) { return input; }
}
`, 'utf8');
    const violations = collectHardForbidViolations(dir);
    if (!violations.some((item) => item.id === 'hard.knowledge.session-end-write' && item.file === 'src/main/knowledge/KnowledgeWriteService.ts')) {
      throw new Error('canonical KnowledgeWriteService path hiding lifecycle write must fail');
    }
  }));

  cases.push(runFixtureCase('hard-knowledge-write-canonical-tool', (dir) => {
    mkdirSync(path.join(dir, 'src', 'main', 'knowledge'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'main', 'knowledge', 'KnowledgeWriteService.ts'), `
export class KnowledgeWriteService {}
export const tools = [{ id: 'knowledge_write', inputSchema: {}, execute() {} }];
`, 'utf8');
    const violations = collectHardForbidViolations(dir);
    if (!violations.some((item) => item.id === 'hard.knowledge.autonomy-tool' && item.file === 'src/main/knowledge/KnowledgeWriteService.ts')) {
      throw new Error('canonical KnowledgeWriteService path hiding knowledge_write tool must fail');
    }
  }));

  cases.push(runFixtureCase('hard-knowledge-write-canonical-clean', (dir) => {
    mkdirSync(path.join(dir, 'src', 'main', 'knowledge'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'main', 'knowledge', 'KnowledgeWriteService.ts'), `
export class KnowledgeWriteService {
  write(input) { return input; }
}
`, 'utf8');
    const violations = collectHardForbidViolations(dir);
    if (violations.some((item) => item.id.startsWith('hard.knowledge.'))) {
      throw new Error(`clean KnowledgeWriteService class must not fail: ${violations.map((item) => item.id).join(',')}`);
    }
  }));

  cases.push(runFixtureCase('hard-knowledge-lifecycle', (dir) => {
    mkdirSync(path.join(dir, 'src', 'main', 'hooks'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'main', 'hooks', 'AutoWrite.ts'), `
export function onSessionEnd() {
  knowledgeWriteService.write({ title: 'auto' });
}
`, 'utf8');
    const violations = collectHardForbidViolations(dir);
    if (!violations.some((item) => item.id === 'hard.knowledge.session-end-write')) {
      throw new Error('SessionEnd KnowledgeWriteService call must fail even if class name is present');
    }
  }));

  cases.push(runFixtureCase('base-new-id-forbidden', (dir) => {
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'legacy.ts'), 'export const LEGACY_MARK = 1;\n', 'utf8');
    writeJson(path.join(dir, 'debt.json'), formatDebt(['demo.forbidden.legacy']));
    git(dir, ['init']);
    git(dir, ['add', 'src/legacy.ts', 'debt.json']);
    git(dir, ['commit', '-m', 'base debt']);
    const base = git(dir, ['rev-parse', 'HEAD']);
    writeJson(path.join(dir, 'debt.json'), formatDebt(['demo.forbidden.legacy', 'demo.missing.target']));
    const registry = fixtureRegistry();
    expectFail(runSystemDebtCheck({
      name: 'self-test',
      repoRoot: dir,
      gitRepoRoot: dir,
      registry,
      debtFile: path.join(dir, 'debt.json'),
      debtRelativePath: 'debt.json',
      skipHardForbids: true,
      baseRef: base,
      env: { CI: 'true' },
      argv: ['--base-ref', base],
    }), 'cannot add debt id');
  }));

  const failed = cases.filter((entry) => !entry.ok);
  for (const entry of cases) {
    console.log(`[self-test] ${entry.label}: ${entry.ok ? 'ok' : entry.message}`);
  }
  if (failed.length > 0) {
    return 1;
  }
  return 0;
}

function loadJsonArg(argv, flag) {
  const value = parseArgValue(argv, flag.replace(/^--/, ''), '');
  if (!value) return null;
  return JSON.parse(readFileSync(value, 'utf8'));
}

function printListAndExit(name, errors) {
  if (errors.length > 0) {
    for (const error of errors) console.error(`[${name}] ${error}`);
    process.exit(1);
  }
  console.log(`[${name}] OK`);
  process.exit(0);
}

if (isDirectInvocation(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    process.exit(runSelfTest());
  }
  if (argv.includes('--inspect-contract-suite')) {
    const suiteFile = parseArgValue(argv, 'suite-file', '');
    const requiredCases = loadJsonArg(argv, '--required-cases-file') || [];
    printListAndExit(
      'inspect-contract-suite',
      inspectContractSuiteSource(readFileSync(suiteFile, 'utf8'), normalizeRequiredCases({ requiredCases }), suiteFile),
    );
  }
  if (argv.includes('--run-contract-suite')) {
    const suiteFile = parseArgValue(argv, 'suite-file', '');
    const requiredCases = normalizeRequiredCases({ requiredCases: loadJsonArg(argv, '--required-cases-file') || [] });
    const inspectErrors = inspectContractSuiteSource(readFileSync(suiteFile, 'utf8'), requiredCases, suiteFile);
    if (inspectErrors.length > 0) printListAndExit('run-contract-suite', inspectErrors);
    const reportPath = path.join(os.tmpdir(), `rdc-system-debt-${randomBytes(8).toString('hex')}.json`);
    try {
      const spawned = spawnVitestOnFile(suiteFile, { reportPath });
      if (spawned.status !== 0) {
        printListAndExit('run-contract-suite', [
          `vitest hard fail (exit ${spawned.status}): ${(spawned.stderr || spawned.stdout || '').trim()}`,
        ]);
      }
      const report = JSON.parse(readFileSync(reportPath, 'utf8'));
      printListAndExit('run-contract-suite', summarizeVitestJson(report, requiredCases));
    } finally {
      try { unlinkSync(reportPath); } catch { /* best-effort */ }
    }
  }
  if (argv.includes('--summarize-vitest-json')) {
    const report = loadJsonArg(argv, '--report-file');
    const requiredCases = normalizeRequiredCases({ requiredCases: loadJsonArg(argv, '--required-cases-file') || [] });
    printListAndExit('summarize-vitest-json', summarizeVitestJson(report, requiredCases));
  }
  if (argv.includes('--hard-forbid-only')) {
    const repoRoot = parseArgValue(argv, 'repo-root', '') || defaultRepoRoot();
    const violations = collectHardForbidViolations(repoRoot);
    printListAndExit(
      'hard-forbid',
      violations.map((item) => `HARD FAIL ${item.id} file=${item.file} pattern=${item.pattern} (${item.note})`),
    );
  }
  if (argv.includes('--evaluate-only')) {
    const repoRoot = parseArgValue(argv, 'repo-root', '') || defaultRepoRoot();
    const registry = loadJsonArg(argv, '--registry-file') || [];
    const measured = evaluateRegistry(registry, repoRoot);
    console.log(JSON.stringify({
      ids: measured.map((hit) => hit.id),
      hits: measured,
    }));
    process.exit(0);
  }
  const registry = loadJsonArg(argv, '--registry-file');
  if (!registry) {
    console.error('[system-debt-ratchet] invoke via check scripts, --self-test, or fixture flags');
    process.exit(2);
  }
  const repoRoot = parseArgValue(argv, 'repo-root', '') || defaultRepoRoot();
  const debtFile = parseArgValue(argv, 'debt-file', '');
  const result = runSystemDebtCheck({
    name: parseArgValue(argv, 'name', '') || 'system-debt',
    repoRoot,
    gitRepoRoot: repoRoot,
    registry,
    debtFile: debtFile || undefined,
    debtRelativePath: debtFile ? toPosix(path.relative(repoRoot, debtFile) || path.basename(debtFile)) : 'debt.json',
    skipHardForbids: argv.includes('--skip-hard-forbids'),
    argv,
    env: process.env,
  });
  process.exit(printCheckResult(parseArgValue(argv, 'name', '') || 'system-debt', result));
}
