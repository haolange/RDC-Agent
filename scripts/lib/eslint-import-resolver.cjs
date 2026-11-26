// eslint-plugin-import resolver for src/: relative and absolute imports and the tsconfig path aliases (@main, @renderer, @shared)
// resolve to TypeScript sources; packages and node: builtins count as external (path null), which import/no-cycle
// never follows. Loaded by eslint.config.mjs; the plugin requires resolvers through CommonJS.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SRC = path.resolve(__dirname, '../../src');
const ALIASES = { '@main/': 'main', '@renderer/': 'renderer', '@shared/': 'shared' };
const CANDIDATES = ['', '.ts', '.tsx', '.d.ts', '.js', '.mjs', '/index.ts', '/index.tsx'];

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function resolveSource(source, file) {
  const alias = Object.keys(ALIASES).find((prefix) => source.startsWith(prefix));
  let base = null;
  if (alias) base = path.join(SRC, ALIASES[alias], source.slice(alias.length));
  else if (source.startsWith('.') || path.isAbsolute(source)) base = path.resolve(path.dirname(file), source);
  if (base === null) return { found: true, path: null };
  // Vite query suffixes (`?raw`, `?url`) name the same file.
  const clean = base.replace(/\?.*$/, '');
  const hit = CANDIDATES.map((suffix) => clean + suffix).find(isFile);
  return hit ? { found: true, path: hit } : { found: false };
}

module.exports = { interfaceVersion: 2, resolve: resolveSource };
