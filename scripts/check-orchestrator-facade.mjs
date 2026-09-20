import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const ORCHESTRATOR_REL = 'src/main/workflow/debugger/AgentOrchestrator.ts';
const MAX_LINES = 800;
const VALUE_IMPORT_MAX = 10;

const fail = (message) => {
  console.error(`[orchestrator-facade] ${message}`);
  process.exitCode = 1;
};

const orchestratorPath = path.join(repoRoot, ORCHESTRATOR_REL);
if (!fs.existsSync(orchestratorPath)) {
  fail(`${ORCHESTRATOR_REL} is required.`);
  process.exit(1);
}

const source = fs.readFileSync(orchestratorPath, 'utf8');
const lineCount = source.split('\n').length;
if (lineCount >= MAX_LINES) {
  fail(`${ORCHESTRATOR_REL} has ${lineCount} lines (façade budget < ${MAX_LINES}). Extract responsibilities out of the façade.`);
} else {
  console.log(`[orchestrator-facade] line budget OK: ${lineCount} < ${MAX_LINES}`);
}

/**
 * Count value (non-type-only) import declarations.
 * Multi-line `import { ... } from '...'` counts as one declaration.
 */
const valueImportDecls = [];
const importBlockRe = /^import\s+(?!type\b)[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm;
let match = importBlockRe.exec(source);
while (match) {
  valueImportDecls.push(match[0].replace(/\s+/g, ' ').trim());
  match = importBlockRe.exec(source);
}

if (valueImportDecls.length > VALUE_IMPORT_MAX) {
  fail(
    `${ORCHESTRATOR_REL} has ${valueImportDecls.length} non-type import declarations `
    + `(hard budget <= ${VALUE_IMPORT_MAX}). Collapse collaborators behind a deps barrel.`,
  );
} else {
  console.log(
    `[orchestrator-facade] value imports OK: ${valueImportDecls.length} <= ${VALUE_IMPORT_MAX}`,
  );
}

const forbiddenGlobalApis = [
  { symbol: 'legacyGlobalMirror', reason: 'RDC context must be per-session lease only' },
  { symbol: 'getRdcRuntimeContext', reason: 'removed global RDC context API; use getRdcContextLease / assertRdcContextLeaseOwnership' },
];

const sourceRoot = path.join(repoRoot, 'src');
const walk = (dir, files = []) => {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(fullPath, files);
      continue;
    }
    if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
};

for (const filePath of walk(sourceRoot)) {
  const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
  const content = fs.readFileSync(filePath, 'utf8');
  for (const { symbol, reason } of forbiddenGlobalApis) {
    if (content.includes(symbol)) {
      fail(`${relativePath} references forbidden symbol "${symbol}" (${reason}).`);
    }
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log('[orchestrator-facade] OK');
