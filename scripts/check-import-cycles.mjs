#!/usr/bin/env node
/**
 * import/no-cycle ratchet (AGENTS.md §5). Production code lints with import/no-cycle (eslint.config.mjs
 * `importCycleLint`); the files in IMPORT_CYCLE_PENDING are exempt, each with its reason. That list only shrinks: an
 * entry whose file is gone, falls outside the rule, or is no longer on a cycle fails the gate, so it leaves the list in
 * the same change that broke the cycle.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tsParser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';
import { ESLint } from 'eslint';
import { IMPORT_CYCLE_PENDING, importCycleLint } from '../eslint.config.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RULE = 'import/no-cycle';

// Only the rule under ratchet runs, on the same files, ignores and resolver as the lint block.
const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfigFile: true,
  overrideConfig: [
    {
      ...importCycleLint,
      languageOptions: {
        parser: tsParser,
        parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
      },
      plugins: { import: importPlugin },
    },
  ],
});

const failures = [];
const lintable = [];
for (const [file, reason] of Object.entries(IMPORT_CYCLE_PENDING)) {
  if (typeof reason !== 'string' || !reason.trim()) failures.push(`${file} needs a reason in IMPORT_CYCLE_PENDING.`);
  if (!fs.existsSync(path.join(repoRoot, file))) {
    failures.push(`${file} no longer exists; remove it from IMPORT_CYCLE_PENDING.`);
    continue;
  }
  const config = await eslint.calculateConfigForFile(file);
  if (!config?.rules?.[RULE]) {
    failures.push(`${file} is not production code under ${RULE}; remove it from IMPORT_CYCLE_PENDING.`);
    continue;
  }
  lintable.push(file);
}

let pendingViolations = 0;
for (const result of lintable.length > 0 ? await eslint.lintFiles(lintable) : []) {
  const file = path.relative(repoRoot, result.filePath).split(path.sep).join('/');
  const fatal = result.messages.find((message) => message.fatal);
  if (fatal) {
    failures.push(`${file}: ${fatal.message}`);
    continue;
  }
  const violations = result.messages.filter((message) => message.ruleId === RULE).length;
  if (violations === 0) failures.push(`${file} is on no import cycle; remove it from IMPORT_CYCLE_PENDING.`);
  pendingViolations += violations;
}

for (const failure of failures) console.error(`[import-cycles] ${failure}`);
if (failures.length > 0) process.exit(1);
console.log(`[import-cycles] OK (${lintable.length} files pending with ${pendingViolations} cyclic imports)`);
