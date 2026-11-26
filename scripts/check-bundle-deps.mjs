#!/usr/bin/env node
// Dependency placement and the renderer entry budget.
//   node scripts/check-bundle-deps.mjs                 package.json placement against what the code imports
//   node scripts/check-bundle-deps.mjs --entry-chunk   also the size of the built renderer entry chunk (needs out/)
//
// electron-vite externalizes `dependencies` for main and preload and electron-builder ships them; the renderer is a
// bundle. So a package the main side imports at runtime must be a dependency, and a package only the renderer uses
// must be a devDependency (otherwise it ships twice). `src/shared` counts for both sides.
import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Bytes the renderer entry chunk may reach; heavy renderers load on demand (markdownEnhancers, mermaid, CodeMirror). */
const ENTRY_CHUNK_BUDGET = 3_100_000;
/** Provided by the Electron runtime itself, never shipped from node_modules. */
const RUNTIME_PROVIDED = new Set(['electron']);

const builtins = new Set(builtinModules.flatMap((name) => [name, name.split('/')[0]]));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const dependencies = new Set(Object.keys(packageJson.dependencies ?? {}));
const devDependencies = new Set(Object.keys(packageJson.devDependencies ?? {}));

/** Source that ships: test files and test support directories are never bundled. */
function sourceFiles(directory) {
  const absolute = path.join(root, directory);
  if (!fs.existsSync(absolute)) return [];
  return fs
    .readdirSync(absolute, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:ts|tsx|mjs|js)$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => !path.relative(root, file).split(path.sep).includes('testing'));
}

/** Required peers of a shipped package; pnpm installs them, and a dependency that is one is needed at runtime. */
function requiredPeers(name) {
  const manifest = path.join(root, 'node_modules', name, 'package.json');
  if (!fs.existsSync(manifest)) return [];
  const { peerDependencies = {}, peerDependenciesMeta = {} } = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  return Object.keys(peerDependencies).filter((peer) => !peerDependenciesMeta[peer]?.optional);
}

const IMPORT_PATTERNS = [
  /(?:^|[\n;])\s*import\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gu,
  /(?:^|[\n;])\s*export\s+(?!type\b)[^'";]*?\sfrom\s+['"]([^'"]+)['"]/gu,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/gu,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/gu,
];

function packageName(specifier) {
  if (/^[./]|^@(?:shared|main|renderer)\/|:/u.test(specifier)) return null;
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  return builtins.has(name) || RUNTIME_PROVIDED.has(name) ? null : name;
}

function importedPackages(directories) {
  const used = new Map();
  for (const file of directories.flatMap(sourceFiles)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of IMPORT_PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        const name = packageName(match[1]);
        if (name && !used.has(name)) used.set(name, path.relative(root, file));
      }
    }
  }
  return used;
}

const runtime = importedPackages(['src/main', 'src/preload', 'src/shared', 'resources/agent-runtime/hooks']);
const peersOfRuntime = new Map([...runtime.keys()].flatMap((name) => requiredPeers(name).map((peer) => [peer, name])));
const renderer = importedPackages(['src/renderer']);
const problems = [];
for (const [name, file] of runtime) {
  if (!dependencies.has(name)) problems.push(`${name} is imported at runtime by ${file} but is not in dependencies`);
}
for (const name of dependencies) {
  if (runtime.has(name) || peersOfRuntime.has(name)) continue;
  problems.push(
    renderer.has(name)
      ? `${name} is used only by the renderer bundle; move it to devDependencies`
      : `${name} is in dependencies but nothing imports it; remove it`,
  );
}
for (const [name, file] of renderer) {
  if (!runtime.has(name) && !devDependencies.has(name))
    problems.push(`${name} is imported by ${file} but is not in devDependencies`);
}

if (process.argv.includes('--entry-chunk')) {
  const html = path.join(root, 'out', 'renderer', 'index.html');
  if (!fs.existsSync(html)) {
    problems.push('out/renderer/index.html is missing; run the build first');
  } else {
    const entry = fs.readFileSync(html, 'utf8').match(/<script[^>]*type="module"[^>]*src="\.?\/?([^"]+)"/u)?.[1];
    const entryPath = entry ? path.join(root, 'out', 'renderer', entry) : null;
    if (!entryPath || !fs.existsSync(entryPath)) {
      problems.push('the renderer entry chunk named by out/renderer/index.html does not exist');
    } else {
      const size = fs.statSync(entryPath).size;
      if (size > ENTRY_CHUNK_BUDGET)
        problems.push(`renderer entry chunk is ${size} bytes; the budget is ${ENTRY_CHUNK_BUDGET}`);
      else console.log(`[bundle-deps] renderer entry chunk ${size} / ${ENTRY_CHUNK_BUDGET} bytes`);
    }
  }
}

if (problems.length) {
  for (const problem of problems) console.error(`[bundle-deps] ${problem}`);
  process.exit(1);
}
console.log(`[bundle-deps] OK (${dependencies.size} dependencies, ${renderer.size} renderer packages)`);
