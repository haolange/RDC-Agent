#!/usr/bin/env node
/**
 * no-unnecessary-condition ratchet (AGENTS.md §5). Production code in main, shared, preload and renderer lints with
 * @typescript-eslint/no-unnecessary-condition (eslint.config.mjs `typedLint`); the files in
 * UNNECESSARY_CONDITION_PENDING are exempt, each with its reason. That list only shrinks: an entry whose file is
 * gone, falls outside the rule, or no longer has a violation fails the gate, so it leaves the list in the same change
 * that cleaned it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import { ESLint } from 'eslint';
import { UNNECESSARY_CONDITION_PENDING, typedLint } from '../eslint.config.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RULE = '@typescript-eslint/no-unnecessary-condition';

// Only the rule under ratchet runs, on the same files, ignores and typed program as the lint block.
const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: typedLint.files,
      ignores: typedLint.ignores,
      languageOptions: {
        parser: tsParser,
        parserOptions: { ...typedLint.languageOptions.parserOptions, ecmaFeatures: { jsx: true } },
      },
      plugins: { '@typescript-eslint': tsPlugin },
      rules: typedLint.rules,
    },
  ],
});

const failures = [];
const lintable = [];
for (const [file, reason] of Object.entries(UNNECESSARY_CONDITION_PENDING)) {
  if (typeof reason !== 'string' || !reason.trim())
    failures.push(`${file} needs a reason in UNNECESSARY_CONDITION_PENDING.`);
  if (!fs.existsSync(path.join(repoRoot, file))) {
    failures.push(`${file} no longer exists; remove it from UNNECESSARY_CONDITION_PENDING.`);
    continue;
  }
  const config = await eslint.calculateConfigForFile(file);
  if (!config?.rules?.[RULE]) {
    failures.push(`${file} is not production code under ${RULE}; remove it from UNNECESSARY_CONDITION_PENDING.`);
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
  if (violations === 0)
    failures.push(`${file} has no ${RULE} violations; remove it from UNNECESSARY_CONDITION_PENDING.`);
  pendingViolations += violations;
}

for (const failure of failures) console.error(`[unnecessary-condition] ${failure}`);
if (failures.length > 0) process.exit(1);
console.log(`[unnecessary-condition] OK (${lintable.length} files pending with ${pendingViolations} violations)`);
