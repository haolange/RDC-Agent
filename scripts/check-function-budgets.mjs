#!/usr/bin/env node
/**
 * Function budget ratchet (AGENTS.md §5). Every production function stays within `budget` in
 * scripts/function-budgets.json: lines (ESLint max-lines-per-function, blank lines and comments not counted),
 * cyclomatic complexity and parameter count. eslint.config.mjs applies the budget to production code, and to each
 * file in `exceptions` the values listed for it. This gate keeps those exceptions tight, so they only shrink: it fails
 * when a listed file is gone, when a listed value is not above the budget, or when it is looser than the file's
 * largest function needs. The entry is lowered, or removed, in the change that shrank the function.
 *
 *   node scripts/check-function-budgets.mjs          check
 *   node scripts/check-function-budgets.mjs --write  measure every production file and rewrite the exceptions
 *                                                    (after lowering the budget itself; review the diff)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tsParser from '@typescript-eslint/parser';
import { ESLint } from 'eslint';
import { functionBudgetRules, functionBudgets, productionCode } from '../eslint.config.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const budgetsPath = path.join(repoRoot, 'scripts/function-budgets.json');
const { budget, exceptions } = functionBudgets;
/** The ESLint rule behind each metric, and where its message carries the measured value. */
const METRICS = {
  lines: { rule: 'max-lines-per-function', value: /\((\d+)\)/ },
  complexity: { rule: 'complexity', value: /complexity of (\d+)/ },
  params: { rule: 'max-params', value: /\((\d+)\)/ },
};

const toRelative = (file) => path.relative(repoRoot, file).split(path.sep).join('/');

/**
 * The largest value of each metric over the functions in each file: the budget rules at zero report every function
 * with its measured value.
 */
async function measure(patterns) {
  const eslint = new ESLint({
    cwd: repoRoot,
    overrideConfigFile: true,
    overrideConfig: [
      { ignores: productionCode.ignores },
      {
        files: productionCode.files,
        languageOptions: {
          parser: tsParser,
          parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
        },
        rules: functionBudgetRules({ lines: 0, complexity: 0, params: 0 }),
      },
    ],
  });
  const measured = new Map();
  for (const result of await eslint.lintFiles(patterns)) {
    const maxima = { lines: 0, complexity: 0, params: 0 };
    for (const message of result.messages) {
      if (message.fatal) throw new Error(`${toRelative(result.filePath)}: ${message.message}`);
      for (const [metric, { rule, value }] of Object.entries(METRICS)) {
        if (message.ruleId !== rule) continue;
        maxima[metric] = Math.max(maxima[metric], Number(message.message.match(value)?.[1] ?? 0));
      }
    }
    measured.set(toRelative(result.filePath), maxima);
  }
  return measured;
}

const aboveBudget = (maxima) =>
  Object.fromEntries(
    Object.keys(METRICS)
      .filter((metric) => maxima[metric] > budget[metric])
      .map((metric) => [metric, maxima[metric]]),
  );

if (process.argv.includes('--write')) {
  const measured = await measure(productionCode.files);
  const next = Object.fromEntries(
    [...measured]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([file, maxima]) => [file, aboveBudget(maxima)])
      .filter(([, entry]) => Object.keys(entry).length > 0),
  );
  fs.writeFileSync(budgetsPath, `${JSON.stringify({ budget, exceptions: next }, null, 2)}\n`, 'utf8');
  console.log(`[function-budgets] wrote ${Object.keys(next).length} exception(s) from ${measured.size} file(s)`);
  process.exit(0);
}

const problems = [];
const listed = Object.keys(exceptions).sort();
const present = listed.filter((file) => fs.existsSync(path.join(repoRoot, file)));
for (const file of listed.filter((entry) => !present.includes(entry))) {
  problems.push(`${file} no longer exists; remove its exception`);
}
const measured = present.length > 0 ? await measure(present) : new Map();
for (const [file, maxima] of measured) {
  for (const [metric, allowed] of Object.entries(exceptions[file])) {
    if (!(metric in METRICS)) {
      problems.push(`${file}: unknown metric ${metric}`);
    } else if (allowed <= budget[metric]) {
      problems.push(`${file}: ${metric} ${allowed} is within the budget ${budget[metric]}; remove it`);
    } else if (maxima[metric] < allowed) {
      const fix = maxima[metric] > budget[metric] ? `lower it to ${maxima[metric]}` : 'remove it';
      problems.push(`${file}: ${metric} listed ${allowed}, largest function needs ${maxima[metric]}; ${fix}`);
    }
  }
}

if (problems.length > 0) {
  console.error(`[function-budgets] ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(
  `[function-budgets] OK (budget ${budget.lines} lines / complexity ${budget.complexity} / ${budget.params} params; ` +
    `${listed.length} file(s) above it, each held at its measured maximum)`,
);
