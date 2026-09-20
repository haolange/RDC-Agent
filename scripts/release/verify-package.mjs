#!/usr/bin/env node
/** Inspect the packaged payload without launching or modifying it. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const unpacked = path.resolve(root, process.argv[2] || 'release/win-unpacked');
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder'));
const libraryRequire = createRequire(builderRequire.resolve('app-builder-lib'));
const asar = libraryRequire('@electron/asar');
const archive = path.join(unpacked, 'resources/app.asar');
const files = asar.listPackage(archive).map(name => name.replaceAll('\\', '/').replace(/^\//, ''));
const sourcePackage = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const packaged = JSON.parse(asar.extractFile(archive, 'package.json').toString());
assert.equal(packaged.version, sourcePackage.version, 'packaged version');
assert.equal(packaged.main, 'out/main/index.js', 'packaged entry');
assert(existsSync(path.join(unpacked, 'RdcAgent.exe')), 'desktop executable missing');
for (const entry of ['out/main/index.js', 'out/preload/index.js', 'out/renderer/index.html']) {
  assert(files.includes(entry), `missing ${entry}`);
}
for (const entry of files) {
  assert(!/^(?:src|scripts|\.git|\.qoder|\.check-tmp|coverage)\//.test(entry), `development payload: ${entry}`);
  assert(!/^(?:pnpm-lock\.yaml|pnpm-workspace\.yaml)$/.test(entry), `development config: ${entry}`);
  assert(!/^node_modules\/(?:pnpm|npm|yarn)(?:\/|$)/.test(entry), `package manager: ${entry}`);
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let resources = 0;
function checkResources(directory, prefix) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    if (item.name === '.gitkeep') continue;
    const source = path.join(directory, item.name);
    const relative = `${prefix}/${item.name}`;
    if (item.isDirectory()) checkResources(source, relative);
    else {
      assert.equal(digest(asar.extractFile(archive, path.join(...relative.split('/')))), digest(readFileSync(source)), `resource differs: ${relative}`);
      resources += 1;
      if (relative.startsWith('resources/agent-runtime/hooks/') && relative.endsWith('.mjs')) {
        const external = path.join(unpacked, 'resources/agent-runtime/hooks', item.name);
        assert.equal(digest(readFileSync(external)), digest(readFileSync(source)), `executable hook differs: ${item.name}`);
      }
    }
  }
}
checkResources(path.join(root, 'resources/agent-runtime'), 'resources/agent-runtime');
for (const name of ['welcome', 'model', 'project', 'rdc']) {
  const assets = files.filter(file => file.startsWith(`out/renderer/assets/${name}-`) && file.endsWith('.png'));
  assert.equal(assets.length, 1, `exactly one tutorial image: ${name}`);
  assert.equal(digest(asar.extractFile(archive, path.join(...assets[0].split('/')))),
    digest(readFileSync(path.join(root, 'src/renderer/features/onboarding/assets', `${name}.png`))),
    `tutorial image differs: ${name}`);
}
console.log(`[release:verify] PASS version=${packaged.version}, bundled resources=${resources}, no development entry or package manager`);
