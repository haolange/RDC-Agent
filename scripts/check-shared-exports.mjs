import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const baselinePath = path.join(repoRoot, 'scripts/fidelity/shared-exports.txt');
const checkPath = path.join(repoRoot, 'scripts/fidelity/.shared-exports-check.txt');

const readSet = (filePath) => new Set(
  fs.readFileSync(filePath, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean),
);

if (!fs.existsSync(baselinePath)) {
  console.error('[shared-exports] Missing baseline. Run: npm run fidelity:extract');
  process.exit(1);
}

const baseline = readSet(baselinePath);
const result = spawnSync(process.execPath, ['scripts/extract-shared-exports.mjs', checkPath], {
  cwd: repoRoot,
  encoding: 'utf8',
});
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const current = readSet(checkPath);
fs.unlinkSync(checkPath);

const missing = [...baseline].filter((item) => !current.has(item)).sort();
if (missing.length > 0) {
  console.error(`[shared-exports] Missing ${missing.length} export symbols:`);
  for (const item of missing.slice(0, 40)) {
    console.error(`  - ${item}`);
  }
  process.exit(1);
}

console.log(`[shared-exports] OK (${baseline.size} symbols, +${current.size - baseline.size} new)`);
