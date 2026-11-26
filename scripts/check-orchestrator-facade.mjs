import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// AgentOrchestrator stays a façade: the composition root (agentRuntimeRoot.ts) constructs its collaborators, and
// every phase of a turn lives in a collaborator. The budgets are the measured maxima; lower them when the façade
// shrinks, never raise them to admit new work.
const repoRoot = process.cwd();
const ORCHESTRATOR_REL = 'src/main/agent-runtime/orchestration/AgentOrchestrator.ts';
/** Distinct modules the façade imports (value or type). */
const FAN_OUT_MAX = 12;
/** Body lines of the longest function, method or arrow function in the façade (the signature is not counted, so a
 * parameter list wrapped by the formatter does not change the measure). */
const FUNCTION_LINES_MAX = 16;

const fail = (message) => {
  console.error(`[orchestrator-facade] ${message}`);
  process.exitCode = 1;
};

const orchestratorPath = path.join(repoRoot, ORCHESTRATOR_REL);
if (!fs.existsSync(orchestratorPath)) {
  fail(`${ORCHESTRATOR_REL} is required.`);
  process.exit(1);
}

const sourceFile = ts.createSourceFile(
  ORCHESTRATOR_REL,
  fs.readFileSync(orchestratorPath, 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

const importedModules = new Set();
for (const statement of sourceFile.statements) {
  if (
    (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
    statement.moduleSpecifier &&
    ts.isStringLiteral(statement.moduleSpecifier)
  ) {
    importedModules.add(statement.moduleSpecifier.text);
  }
}

const lineOf = (position) => sourceFile.getLineAndCharacterOfPosition(position).line;
const functionLengths = [];
const visit = (node) => {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node)) &&
    node.body
  ) {
    const name =
      node.name && ts.isIdentifier(node.name)
        ? node.name.text
        : ts.isConstructorDeclaration(node)
          ? 'constructor'
          : '(anonymous)';
    functionLengths.push({ name, lines: lineOf(node.body.getEnd()) - lineOf(node.body.getStart(sourceFile)) + 1 });
  }
  ts.forEachChild(node, visit);
};
visit(sourceFile);
const longest = functionLengths.reduce((max, entry) => (entry.lines > max.lines ? entry : max), {
  name: '(none)',
  lines: 0,
});

if (importedModules.size > FAN_OUT_MAX) {
  fail(
    `${ORCHESTRATOR_REL} imports ${importedModules.size} modules (budget ${FAN_OUT_MAX}). Move the work into a collaborator built by agentRuntimeRoot.ts.`,
  );
}
if (longest.lines > FUNCTION_LINES_MAX) {
  fail(
    `${ORCHESTRATOR_REL}: ${longest.name} is ${longest.lines} lines (budget ${FUNCTION_LINES_MAX}). Split it into named phases.`,
  );
}
if (process.exitCode) process.exit(process.exitCode);

console.log(
  `[orchestrator-facade] fan-out ${importedModules.size} <= ${FAN_OUT_MAX}; longest function ${longest.name} ${longest.lines} <= ${FUNCTION_LINES_MAX} lines`,
);
console.log('[orchestrator-facade] OK');
