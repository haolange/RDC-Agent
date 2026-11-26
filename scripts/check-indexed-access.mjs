#!/usr/bin/env node
/**
 * noUncheckedIndexedAccess ratchet (AGENTS.md §5). Production code under src/ is type-checked with the flag on, and
 * every directory is held to zero errors except the ones in PENDING_DIRECTORIES. That list only shrinks: a listed
 * directory that is already clean (or no longer exists) fails the gate, so it leaves the list in the same change that
 * cleaned it. A directory is matched exactly, so each subdirectory stands on its own. Tests and src/main/testing are
 * outside the ratchet.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PENDING_DIRECTORIES = new Set([
  'src/main/agent-runtime',
  'src/main/agent-runtime/agent',
  'src/main/agent-runtime/context',
  'src/main/agent-runtime/memory',
  'src/main/agent-runtime/orchestration',
  'src/main/agent-runtime/permissions',
  'src/main/agent-runtime/prompt',
  'src/main/agent-runtime/providers',
  'src/main/agent-runtime/reasoning',
  'src/main/agent-runtime/tools',
  'src/main/agent-runtime/tools/primitives',
  'src/main/agent-runtime/tools/system',
  'src/main/commands',
  'src/main/commands/builtins',
  'src/main/conversation',
  'src/main/investigation',
  'src/main/knowledge',
  'src/main/provider-catalog',
  'src/main/rdc',
  'src/main/rdc/captures',
  'src/main/reports',
  'src/main/sessions/artifacts',
  'src/main/sessions/run',
  'src/main/sessions/store',
  'src/main/settings/agent-manifests',
  'src/main/settings/provider-auth',
  'src/main/settings/provider-auth/oauth',
  'src/main/settings/provider-catalog',
  'src/main/settings/settings-core',
  'src/main/window',
  'src/main/workers',
  'src/renderer/features/composer',
  'src/renderer/features/knowledge/KnowledgeCenterModal',
  'src/renderer/features/knowledge/KnowledgeCenterModal/parts',
  'src/renderer/features/right-rail',
  'src/renderer/features/settings/SettingsModal',
  'src/renderer/features/settings/SettingsModal/sections',
  'src/renderer/features/transcript',
  'src/renderer/lib',
  'src/renderer/patterns/Markdown',
  'src/renderer/patterns/attachments',
  'src/renderer/stores',
  'src/renderer/ui',
  'src/renderer/ui/ContextMenu',
  'src/shared/utils',
]);

const toRelative = (fileName) => path.relative(repoRoot, fileName).split(path.sep).join('/');
const isProductionSource = (relativePath) =>
  relativePath.startsWith('src/') &&
  /\.tsx?$/u.test(relativePath) &&
  !/\.(test|d)\.tsx?$/u.test(relativePath) &&
  !relativePath.startsWith('src/main/testing/');

const configPath = path.join(repoRoot, 'tsconfig.json');
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
if (configFile.error) {
  console.error(`[indexed-access] ${ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n')}`);
  process.exit(1);
}
const parsed = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  repoRoot,
  { noUncheckedIndexedAccess: true, noEmit: true, incremental: false },
  configPath,
);
// Declaration files stay in the program for their globals (the preload API on window); tests are left out.
const rootNames = parsed.fileNames.filter((fileName) => !/\.test\.tsx?$/u.test(fileName));
const program = ts.createProgram({ rootNames, options: parsed.options });

const errorCountByDirectory = new Map();
const failures = [];
let checkedFiles = 0;
for (const sourceFile of program.getSourceFiles()) {
  const relativePath = toRelative(sourceFile.fileName);
  if (!isProductionSource(relativePath)) continue;
  checkedFiles += 1;
  const diagnostics = program.getSemanticDiagnostics(sourceFile);
  if (diagnostics.length === 0) continue;
  const directory = path.posix.dirname(relativePath);
  errorCountByDirectory.set(directory, (errorCountByDirectory.get(directory) ?? 0) + diagnostics.length);
  if (PENDING_DIRECTORIES.has(directory)) continue;
  for (const diagnostic of diagnostics) {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
    failures.push(`${relativePath}:${line + 1}:${character + 1} ${message}`);
  }
}
for (const directory of PENDING_DIRECTORIES) {
  if (!errorCountByDirectory.has(directory)) {
    failures.push(`${directory} has no indexed-access errors; remove it from PENDING_DIRECTORIES.`);
  }
}

for (const failure of failures) console.error(`[indexed-access] ${failure}`);
if (failures.length > 0) process.exit(1);
const pendingErrors = [...errorCountByDirectory.values()].reduce((sum, count) => sum + count, 0);
console.log(
  `[indexed-access] OK (${checkedFiles} production files; ${PENDING_DIRECTORIES.size} directories pending with ${pendingErrors} errors)`,
);
