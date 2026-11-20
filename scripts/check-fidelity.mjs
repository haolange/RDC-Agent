import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// The renderer's QA contract is its data-testid set (Browser QA and SSR tests address the UI by it)
// plus the protected effects registered in renderer-contract.json. Class names, CSS and markup are
// free to change; readability is enforced by check:design-tokens and the Browser QA readability pass.
const repoRoot = process.cwd();
const fidelityDir = path.join(repoRoot, 'scripts/fidelity');
const baselineTestFile = path.join(fidelityDir, 'fidelity-testids.txt');
const checkDir = path.join(fidelityDir, '.check-tmp');

const readSet = (filePath) => {
  if (!fs.existsSync(filePath)) {
    console.error(`[fidelity] Missing baseline file: ${path.relative(repoRoot, filePath)}; run pnpm run fidelity:extract`);
    process.exit(1);
  }
  return new Set(fs.readFileSync(filePath, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean));
};

const baselineTestIds = readSet(baselineTestFile);
fs.rmSync(checkDir, { recursive: true, force: true });
const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/extract-fidelity-contract.mjs'), checkDir], {
  cwd: repoRoot,
  encoding: 'utf8',
});
if (result.status !== 0) {
  console.error(result.stderr || result.stdout);
  process.exit(result.status ?? 1);
}
const currentTestIds = readSet(path.join(checkDir, 'fidelity-testids.txt'));
fs.rmSync(checkDir, { recursive: true, force: true });

const missing = [...baselineTestIds].filter((id) => !currentTestIds.has(id)).sort();
if (missing.length > 0) {
  console.error(`[fidelity] Missing data-testid values (${missing.length}); remove them from the baseline only with the QA flow that used them:`);
  for (const id of missing.slice(0, 50)) console.error(`  - ${id}`);
  process.exit(1);
}

const contract = JSON.parse(fs.readFileSync(path.join(fidelityDir, 'renderer-contract.json'), 'utf8'));
for (const effect of contract.protectedEffects ?? []) {
  const source = fs.readFileSync(path.join(repoRoot, effect.file), 'utf8');
  if (!source.includes(effect.anchor)) {
    console.error(`[fidelity] Protected effect ${effect.id} lost anchor ${effect.anchor} in ${effect.file}`);
    process.exitCode = 1;
  }
}
if (process.exitCode) process.exit(process.exitCode);

const added = [...currentTestIds].filter((id) => !baselineTestIds.has(id)).length;
console.log(`[fidelity] OK (${baselineTestIds.size} test ids; +${added} new)`);
