import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const fidelityDir = path.join(repoRoot, 'scripts/fidelity');
const baselineClassFile = path.join(fidelityDir, 'fidelity-classnames.txt');
const baselineTestFile = path.join(fidelityDir, 'fidelity-testids.txt');
const checkDir = path.join(fidelityDir, '.check-tmp');

const readSet = (filePath) => {
  if (!fs.existsSync(filePath)) {
    console.error(`[fidelity] Missing baseline file: ${path.relative(repoRoot, filePath)}`);
    console.error('[fidelity] Run: npm run fidelity:extract');
    process.exit(1);
  }
  return new Set(
    fs.readFileSync(filePath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );
};

const diff = (baseline, current, label) => {
  const missing = [...baseline].filter((item) => !current.has(item)).sort();
  if (missing.length === 0) {
    return [];
  }
  console.error(`[fidelity] Missing ${label} (${missing.length}):`);
  for (const item of missing.slice(0, 50)) {
    console.error(`  - ${item}`);
  }
  if (missing.length > 50) {
    console.error(`  ... and ${missing.length - 50} more`);
  }
  return missing;
};

const baselineClasses = readSet(baselineClassFile);
const baselineTestIds = readSet(baselineTestFile);

fs.rmSync(checkDir, { recursive: true, force: true });
fs.mkdirSync(checkDir, { recursive: true });

const extractScript = path.join(repoRoot, 'scripts/extract-fidelity-contract.mjs');
const result = spawnSync(process.execPath, [extractScript, checkDir], {
  cwd: repoRoot,
  encoding: 'utf8',
});
if (result.status !== 0) {
  console.error(result.stderr || result.stdout);
  process.exit(result.status ?? 1);
}

const currentClasses = readSet(path.join(checkDir, 'fidelity-classnames.txt'));
const currentTestIds = readSet(path.join(checkDir, 'fidelity-testids.txt'));
fs.rmSync(checkDir, { recursive: true, force: true });

const missingClasses = diff(baselineClasses, currentClasses, 'class names');
const missingTestIds = diff(baselineTestIds, currentTestIds, 'data-testid values');

if (missingClasses.length > 0 || missingTestIds.length > 0) {
  process.exit(1);
}

const addedClasses = [...currentClasses].filter((item) => !baselineClasses.has(item)).length;
const addedTestIds = [...currentTestIds].filter((item) => !baselineTestIds.has(item)).length;

console.log(
  `[fidelity] OK (baseline: ${baselineClasses.size} classes, ${baselineTestIds.size} testids; `
  + `added: +${addedClasses} classes, +${addedTestIds} testids allowed)`,
);
