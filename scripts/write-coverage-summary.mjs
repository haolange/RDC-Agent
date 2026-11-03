import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const sourcePath = path.resolve(repoRoot, process.argv[2] ?? 'coverage/coverage-final.json');
const outputPath = path.resolve(repoRoot, process.argv[3] ?? 'coverage/renderer/coverage-summary.json');
const coverage = JSON.parse(readFileSync(sourcePath, 'utf8'));

const totals = {
  statements: [0, 0],
  functions: [0, 0],
  branches: [0, 0],
  lines: [0, 0],
};

for (const file of Object.values(coverage)) {
  for (const hits of Object.values(file.s ?? {})) {
    totals.statements[1] += 1;
    if (hits > 0) totals.statements[0] += 1;
  }
  for (const hits of Object.values(file.f ?? {})) {
    totals.functions[1] += 1;
    if (hits > 0) totals.functions[0] += 1;
  }
  for (const hits of Object.values(file.b ?? {})) {
    for (const branch of hits) {
      totals.branches[1] += 1;
      if (branch > 0) totals.branches[0] += 1;
    }
  }
  const lineHits = new Map();
  for (const [id, location] of Object.entries(file.statementMap ?? {})) {
    const line = location.start.line;
    lineHits.set(line, (lineHits.get(line) ?? 0) + (file.s[id] ?? 0));
  }
  for (const hits of lineHits.values()) {
    totals.lines[1] += 1;
    if (hits > 0) totals.lines[0] += 1;
  }
}

const pct = ([covered, total]) => (total === 0 ? 100 : Number(((covered / total) * 100).toFixed(2)));
const summary = {
  total: {
    lines: { pct: pct(totals.lines) },
    functions: { pct: pct(totals.functions) },
    branches: { pct: pct(totals.branches) },
    statements: { pct: pct(totals.statements) },
  },
};
mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`[coverage-summary] ${path.relative(repoRoot, outputPath)} ${JSON.stringify(summary.total)}`);
