/**
 * Forbidden-structure checks for the Knowledge and Investigation systems. A rule names something that must not exist
 * in the source tree (a retired module, an autonomous write path, a resurrected schema); any hit fails the gate.
 * Required behaviour is proven by the contract suites under src/main/testing, not by source-text pins here.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIP_DIRS = new Set(['node_modules', 'out', 'dist', 'coverage', '.git']);
const SOURCE_FILE = /\.(?:ts|tsx|js|mjs|cjs|json|md)$/;
const TEST_FILE = /\.test\.(?:ts|tsx|js|mjs)$/;
const CANONICAL_TASKS_DIR = 'src/main/agent-runtime/tasks/';

const toPosix = (relativePath) => String(relativePath).replaceAll('\\', '/');
const resolveRulePath = (repoRoot, file) => path.join(repoRoot, ...toPosix(file).split('/').filter(Boolean));
const relativePosix = (repoRoot, absolute) => toPosix(path.relative(repoRoot, absolute));

export function defaultRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

export function isDirectInvocation(metaUrl, argv1 = process.argv[1]) {
  return Boolean(argv1) && path.normalize(fileURLToPath(metaUrl)) === path.normalize(path.resolve(argv1));
}

function walkFiles(root, { includeTests = false } = {}) {
  const out = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) visit(full);
      } else if (SOURCE_FILE.test(entry.name) && (includeTests || !TEST_FILE.test(entry.name))) {
        out.push(full);
      }
    }
  };
  if (existsSync(root)) visit(root);
  return out;
}

function sourceMatches(source, rule) {
  if (!new RegExp(rule.pattern).test(source)) return false;
  return !(rule.unlessPattern && new RegExp(rule.unlessPattern).test(source));
}

/** Files (or the directory) where a forbidden rule matches; empty means the rule holds. */
function forbiddenMatches(rule, repoRoot) {
  const target = resolveRulePath(repoRoot, rule.file);
  switch (rule.probe) {
    case 'dir-exists':
      return existsSync(target) && statSync(target).isDirectory() ? [rule.file] : [];
    case 'walk-pattern':
      return walkFiles(target, { includeTests: Boolean(rule.includeTests) })
        .filter((file) => sourceMatches(readFileSync(file, 'utf8'), rule))
        .map((file) => relativePosix(repoRoot, file));
    case 'walk-path-and-content': {
      const pathPattern = new RegExp(rule.pattern);
      return (rule.roots ?? [rule.file]).flatMap((root) => walkFiles(resolveRulePath(repoRoot, root), { includeTests: Boolean(rule.includeTests) }))
        .filter((file) => pathPattern.test(relativePosix(repoRoot, file)) || sourceMatches(readFileSync(file, 'utf8'), rule))
        .map((file) => relativePosix(repoRoot, file));
    }
    case 'source-pattern':
      return existsSync(target) && statSync(target).isFile() && sourceMatches(readFileSync(target, 'utf8'), rule) ? [rule.file] : [];
    default:
      throw new Error(`rule ${rule.id} has unknown probe ${rule.probe}`);
  }
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

function isExtraTaskStoreImplementation(source, posixPath) {
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

function hasForbiddenKnowledgeWriteToken(source) {
  return FORBIDDEN_KNOWLEDGE_WRITE_TOKENS.some((token) => knowledgeWriteTokenPattern(token).test(source));
}

function hasLifecycleKnowledgeWrite(source) {
  if (!KNOWLEDGE_WRITE_CALL_RE.test(source)) return false;
  const matches = [...source.matchAll(new RegExp(LIFECYCLE_RE.source, 'g'))];
  return matches.some((match) => {
    const start = Math.max(0, match.index - 80);
    const end = Math.min(source.length, match.index + 1200);
    return KNOWLEDGE_WRITE_CALL_RE.test(source.slice(start, end));
  });
}

function isLegitimateRdcCliSurface(posixPath) {
  return /RdcCliInvokerSettings|RdcShellAction/.test(posixPath);
}

function hasRdcMcpRegistration(source) {
  return (
    /mcpServers?\s*[:=][\s\S]{0,500}(?:name|id|command|descriptorId)\s*:\s*['"][^'"]*rdc/i.test(source)
    || /(?:name|id|descriptorId)\s*:\s*['"]rdc(?:-mcp)?['"][\s\S]{0,240}(?:command|transport|mcpServers?|url)/i.test(source)
    || /AgentRuntimeMcpDescriptor[\s\S]{0,240}['"]rdc/i.test(source)
    || /createMcpServer\([^)]*rdc/i.test(source)
    || /mcp__rdc__/i.test(source)
  );
}

function hasRdAgentToolRegistration(source, posixPath) {
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

function collectHardForbidViolations(repoRoot) {
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

    const cliSurface = isLegitimateRdcCliSurface(posixPath);
    if (hasRdcMcpRegistration(source) || (!cliSurface && hasRdAgentToolRegistration(source, posixPath))) {
      violations.push({
        id: 'hard.rdc-mcp-or-rd-tools',
        file: posixPath,
        pattern: 'RDC MCP registration or rd.* AgentTool/catalog registration',
        note: 'RDC MCP or rd.* Agent tool schema registration is forbidden',
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

/** Every forbidden rule and hard-forbidden structure must have zero hits. */
export function runForbiddenCheck({ name, repoRoot = defaultRepoRoot(), rules, hardForbids = true }) {
  const errors = [];
  for (const rule of rules) {
    for (const file of forbiddenMatches(rule, repoRoot)) errors.push(`${rule.id} file=${file} (${rule.note})`);
  }
  if (hardForbids) {
    for (const violation of collectHardForbidViolations(repoRoot)) {
      errors.push(`${violation.id} file=${violation.file} pattern=${violation.pattern} (${violation.note})`);
    }
  }
  return { name, ok: errors.length === 0, errors, ruleCount: rules.length };
}

export function printForbiddenCheck(result) {
  for (const error of result.errors) console.error(`[${result.name}] ${error}`);
  if (result.ok) console.log(`[${result.name}] OK (${result.ruleCount} forbidden rules, 0 hits)`);
  return result.ok ? 0 : 1;
}
