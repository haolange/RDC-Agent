import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const contract = JSON.parse(
  fs.readFileSync(path.join(root, 'scripts/fidelity/renderer-contract.json'), 'utf8'),
);

export const CONTRACT_ROOT = root;
export const CONTRACT_FILES = contract.files;
export const CONTRACT_RETIRED = contract.retired;
export const CONTRACT_GROUPS = contract.groups ?? {};

const normalize = (relativePath) => relativePath.replace(/\\/g, '/');

const filesByPath = new Map(
  Object.entries(CONTRACT_FILES).map(([key, relative]) => [normalize(relative), key]),
);

const retiredSet = new Set(CONTRACT_RETIRED.map(normalize));

export const contractPath = (key) => {
  const relative = CONTRACT_FILES[key];
  if (!relative) {
    throw new Error(`[renderer-contract] unknown file key: ${key}`);
  }
  return path.join(root, relative);
};

export const contractRel = (key) => {
  const relative = CONTRACT_FILES[key];
  if (!relative) {
    throw new Error(`[renderer-contract] unknown file key: ${key}`);
  }
  return normalize(relative);
};

export const readContract = (key) => {
  const absolute = contractPath(key);
  if (!fs.existsSync(absolute)) {
    throw new Error(`[renderer-contract] missing required file for key "${key}": ${contractRel(key)}`);
  }
  return fs.readFileSync(absolute, 'utf8');
};

export const contractExists = (key) => fs.existsSync(contractPath(key));

export const retiredPaths = () => CONTRACT_RETIRED.map(normalize);

export const requireRegistered = (relativePath) => {
  const normalized = normalize(relativePath);
  if (!filesByPath.has(normalized) && !retiredSet.has(normalized)) {
    throw new Error(`[renderer-contract] unregistered path: ${normalized}`);
  }
  return normalized;
};

export const scriptRead = (relativePath, _encoding) => {
  const normalized = requireRegistered(relativePath);
  if (retiredSet.has(normalized)) {
    throw new Error(`[renderer-contract] refused to read retired path: ${normalized}`);
  }
  return readContract(filesByPath.get(normalized));
};

/** Read a registered CSS entry and inline relative `@import` siblings. */
export const scriptReadCssBundle = (relativePath) => {
  const entry = requireRegistered(relativePath);
  const seen = new Set();
  const walk = (rel) => {
    const normalized = normalize(rel);
    if (seen.has(normalized)) return '';
    seen.add(normalized);
    const absolute = path.join(root, normalized);
    if (!fs.existsSync(absolute)) {
      throw new Error(`[renderer-contract] missing CSS import: ${normalized}`);
    }
    const css = fs.readFileSync(absolute, 'utf8');
    const imports = [...css.matchAll(/@import\s+['"](\.[^'"]+)['"]/g)].map((match) => match[1]);
    const dir = path.posix.dirname(normalized);
    const body = css.replace(/@import\s+['"]\.[^'"]+['"];?\s*/g, '');
    const children = imports.map((imp) => walk(path.posix.normalize(`${dir}/${imp}`)));
    return [...children, body].join('\n');
  };
  return walk(entry);
};

export const scriptExists = (relativePath) => {
  const normalized = requireRegistered(relativePath);
  return fs.existsSync(path.join(root, normalized));
};

export const contractGroup = (name) => {
  const keys = CONTRACT_GROUPS[name];
  if (!keys) {
    throw new Error(`[renderer-contract] unknown group: ${name}`);
  }
  return keys.map((entry) => (entry.includes('/') ? requireRegistered(entry) : contractRel(entry)));
};

export const assertRetiredAbsent = (fail) => {
  for (const relative of retiredPaths()) {
    if (fs.existsSync(path.join(root, relative))) {
      fail(`retired path must remain deleted: ${relative}`);
    }
  }
};

export const assertContractIntegrity = (fail) => {
  for (const [key, relative] of Object.entries(CONTRACT_FILES)) {
    if (!fs.existsSync(path.join(root, relative))) {
      fail(`contract file missing for key "${key}": ${normalize(relative)}`);
    }
  }
  assertRetiredAbsent(fail);
};

/** Structural rules hold at zero: any hit fails the gate. */
export const requireZeroHits = ({ id, hits }) => {
  const current = typeof hits === 'number' ? hits : hits.length;
  if (current > 0) {
    console.error(`[${id}] ${current} hit(s); the rule allows none.`);
    process.exit(1);
  }
  console.log(`[${id}] OK (0 hits)`);
};
