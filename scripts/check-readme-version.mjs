#!/usr/bin/env node
// Both READMEs state the source version; it must be the one package.json carries.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
let failed = false;
for (const name of ['README.md', 'README.en.md']) {
  const stated = [...readFileSync(path.join(root, name), 'utf8').matchAll(/\*\*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?) /gu)]
    .map((match) => match[1]);
  if (stated.length === 0) {
    console.error(`[readme-version] ${name} states no source version.`);
    failed = true;
  } else if (stated.some((value) => value !== version)) {
    console.error(`[readme-version] ${name} states ${[...new Set(stated)].join(', ')}; package.json is ${version}.`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log(`[readme-version] OK (${version})`);
