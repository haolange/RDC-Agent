import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const ORCHESTRATOR_REL = 'src/main/agent-runtime/orchestration/AgentOrchestrator.ts';
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

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log('[orchestrator-facade] OK');
