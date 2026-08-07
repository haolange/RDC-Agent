#!/usr/bin/env node
/**
 * Coverage ratchet — only-up gate for lines/functions/branches/statements.
 *
 * Reads vitest json-summary at coverage/coverage-summary.json and compares
 * against scripts/fidelity/coverage-ratchet.json.
 *
 * Init when missing (after `pnpm run test:coverage`):
 *   node -e "const s=require('./coverage/coverage-summary.json').total; console.log(JSON.stringify({lines:s.lines.pct,functions:s.functions.pct,branches:s.branches.pct,statements:s.statements.pct},null,2))" > scripts/fidelity/coverage-ratchet.json
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const summaryPath = path.join(repoRoot, 'coverage', 'coverage-summary.json');
const ratchetPath = path.join(repoRoot, 'scripts', 'fidelity', 'coverage-ratchet.json');
const METRICS = ['lines', 'functions', 'branches', 'statements'];

function fail(message) {
  console.error(`[coverage-ratchet] ${message}`);
  process.exitCode = 1;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

if (!existsSync(summaryPath)) {
  fail(`Missing ${path.relative(repoRoot, summaryPath)}. Run \`pnpm run test:coverage\` first.`);
  process.exit(process.exitCode ?? 1);
}

const summary = readJson(summaryPath);
const total = summary.total;
if (!total || typeof total !== 'object') {
  fail('coverage-summary.json is missing a total block.');
  process.exit(process.exitCode ?? 1);
}

const measured = {};
for (const metric of METRICS) {
  const pct = total[metric]?.pct;
  if (typeof pct !== 'number' || Number.isNaN(pct)) {
    fail(`coverage-summary.json total.${metric}.pct is not a number.`);
  } else {
    measured[metric] = pct;
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

if (!existsSync(ratchetPath)) {
  console.error('[coverage-ratchet] Missing ratchet file.');
  console.error(`[coverage-ratchet] Create it from the current summary with:`);
  console.error(
    `  node -e "const s=require('./coverage/coverage-summary.json').total; console.log(JSON.stringify({lines:s.lines.pct,functions:s.functions.pct,branches:s.branches.pct,statements:s.statements.pct},null,2))" > scripts/fidelity/coverage-ratchet.json`,
  );
  console.error('[coverage-ratchet] Current measured totals:');
  console.error(JSON.stringify(measured, null, 2));
  if (process.env.RDC_AGENT_COVERAGE_RATCHET_INIT === '1') {
    writeFileSync(ratchetPath, `${JSON.stringify(measured, null, 2)}\n`, 'utf8');
    console.log(`[coverage-ratchet] Wrote ${path.relative(repoRoot, ratchetPath)} (init).`);
    process.exit(0);
  }
  process.exit(1);
}

const ratchet = readJson(ratchetPath);
for (const metric of METRICS) {
  const floor = ratchet[metric];
  if (typeof floor !== 'number' || Number.isNaN(floor)) {
    fail(`ratchet.${metric} must be a number.`);
    continue;
  }
  const actual = measured[metric];
  if (actual + 1e-9 < floor) {
    fail(`${metric} coverage regressed: ${actual} < ratchet ${floor}`);
  }
}

if (!process.exitCode) {
  console.log(`[coverage-ratchet] OK ${JSON.stringify(measured)}`);
}
