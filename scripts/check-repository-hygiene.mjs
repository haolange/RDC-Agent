#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  console.error(`[repository-hygiene] ${message}`);
  process.exitCode = 1;
}

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function git(args, allowFailure = false) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (!allowFailure && result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  }
  return result;
}

function listFiles(relativeRoot) {
  const root = path.join(repoRoot, relativeRoot);
  if (!existsSync(root)) return [];
  const result = [];
  const visit = (target) => {
    const stats = statSync(target);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(target).sort()) visit(path.join(target, entry));
    } else {
      result.push(path.relative(repoRoot, target).replaceAll('\\', '/'));
    }
  };
  visit(root);
  return result;
}

const tracked = git(['ls-files', '-z']).stdout.split('\0').filter(Boolean).map((file) => file.replaceAll('\\', '/'));
const forbiddenTracked = tracked.filter((file) => existsSync(path.join(repoRoot, file)) && (/^(?:node_modules|out|dist|release|build|coverage|tmp|browser-session-tmp|logs|workspace)(?:\/|$)/.test(file)
  || /(?:^|\/)(?:\.pnpm-store|\.cache)(?:\/|$)/.test(file)
  || /\.(?:log|tmp|temp|tsbuildinfo)$/.test(file)));
if (forbiddenTracked.length > 0) fail(`Generated/runtime files are tracked:\n${forbiddenTracked.join('\n')}`);

const forbiddenPaths = ['cli', 'e2e', 'docs/handover'];
for (const relativePath of forbiddenPaths) {
  const absolute = path.join(repoRoot, relativePath);
  const trackedHits = tracked.filter((file) => file === relativePath || file.startsWith(`${relativePath}/`));
  if (trackedHits.length > 0) {
    fail(`Forbidden path is tracked (remove and do not reintroduce):\n${trackedHits.join('\n')}`);
  }
  if (existsSync(absolute)) {
    fail(`Forbidden path exists in the working tree: ${relativePath}`);
  }
}

const rootLogFiles = readdirSync(repoRoot).filter((entry) => {
  const absolute = path.join(repoRoot, entry);
  return statSync(absolute).isFile() && /\.log$/i.test(entry);
});
if (rootLogFiles.length > 0) {
  fail(`Root log files are not allowed:\n${rootLogFiles.join('\n')}`);
}

const allowedRootFiles = new Set([
  'AGENTS.md',
  'DESIGN.md',
  'README.md',
  'LICENSE',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'electron-builder.json',
  'electron.vite.config.ts',
  'vite.renderer.config.ts',
  'vitest.config.ts',
]);
const unexpectedRootFiles = readdirSync(repoRoot).filter((entry) => {
  if (entry.startsWith('.')) return false;
  const absolute = path.join(repoRoot, entry);
  return statSync(absolute).isFile() && !allowedRootFiles.has(entry);
});
if (unexpectedRootFiles.length > 0) {
  fail(`Unexpected root files (update the hygiene allowlist only for deliberate additions):\n${unexpectedRootFiles.join('\n')}`);
}

const designsRoot = path.join(repoRoot, 'designs');
if (existsSync(designsRoot)) {
  const designEntries = readdirSync(designsRoot).filter((entry) => {
    const absolute = path.join(designsRoot, entry);
    return !entry.startsWith('.') && statSync(absolute).isDirectory();
  });
  const unexpectedDesigns = designEntries.filter((entry) => entry !== 'rdc-agent-design-system');
  if (unexpectedDesigns.length > 0) {
    fail(`designs/ may only contain rdc-agent-design-system; remove review prototypes:\n${unexpectedDesigns.join('\n')}`);
  }
}

for (const lockfile of ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock']) {
  if (existsSync(path.join(repoRoot, lockfile))) fail(`Non-pnpm lockfile is present: ${lockfile}`);
}
for (const required of ['pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
  if (!existsSync(path.join(repoRoot, required))) fail(`Required pnpm file is missing: ${required}`);
}
const workspaceConfig = read('pnpm-workspace.yaml');
if (!/^storeDir: ~\/.cache\/rdc-agent\/pnpm-store$/m.test(workspaceConfig)) fail('pnpm-workspace.yaml must enforce the per-user pnpm store.');
if (!/^preferOffline: true$/m.test(workspaceConfig)) fail('pnpm-workspace.yaml must prefer the local pnpm store.');

const packageJson = JSON.parse(read('package.json'));
if (packageJson.packageManager !== 'pnpm@11.7.0') fail('packageManager must be pnpm@11.7.0.');
if (packageJson.build) fail('electron-builder configuration must live only in electron-builder.json.');
const canonicalScripts = {
  start: 'node scripts/launch-rdc-agent.mjs --mode desktop',
  dev: 'node scripts/launch-rdc-agent.mjs --mode desktop-dev',
  'start:human': 'node scripts/launch-rdc-agent.mjs --mode desktop',
  'start:human:dev': 'node scripts/launch-rdc-agent.mjs --mode desktop-dev',
  'start:agent-browser': 'node scripts/launch-rdc-agent.mjs --mode browser',
  'start:agent-browser:dev': 'node scripts/launch-rdc-agent.mjs --mode browser-dev',
};
for (const [name, command] of Object.entries(canonicalScripts)) {
  if (packageJson.scripts?.[name] !== command) fail(`Script ${name} must route through the shared launcher.`);
}
if ('preview' in (packageJson.scripts ?? {})) fail('Legacy preview script must not bypass the shared launcher.');

const operationalFiles = [
  '.github/workflows/ci.yml',
  'README.md',
  'src/main/agent-runtime/permissions/AgentPermissionPolicy.ts',
  'src/main/commands/builtins/test.ts',
  'src/main/settings/README.md',
  ...listFiles('docs/architecture'),
  ...listFiles('docs/workflows'),
];
for (const relativePath of operationalFiles) {
  if (/\bnpm\b|\bnpx\b/.test(read(relativePath))) fail(`Operational package-manager drift found in ${relativePath}.`);
}

for (const seedPath of ['resources/knowledge/seed/library/README.md', 'resources/knowledge/seed/spec/README.md']) {
  const ignored = git(['check-ignore', '--no-index', '-q', seedPath], true).status === 0;
  if (ignored) fail(`Distributable knowledge resource is ignored: ${seedPath}`);
}

const builder = JSON.parse(read('electron-builder.json'));
if (!builder.files?.includes('out/**/*')) fail('electron-builder.json must package out/**/* only as the compiled application input.');
if (builder.files?.some((entry) => /^(?:scripts|node_modules|\.pnpm-store|pnpm-lock|\.npmrc)/.test(entry))) {
  fail('electron-builder files whitelist includes a development-only path.');
}
for (const iconPath of ['resources/icons/icon.ico', 'resources/icons/icon.icns', 'resources/icons/icon.png']) {
  if (!existsSync(path.join(repoRoot, iconPath))) fail(`Release icon is missing: ${iconPath}`);
}

if (!process.exitCode) console.log('[repository-hygiene] OK');
