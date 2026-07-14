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
    console.error('[fidelity] Run: pnpm run fidelity:extract');
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

const appShellCss = fs.readFileSync(
  path.join(repoRoot, 'src/renderer/styles/global/app-shell.css'),
  'utf8',
);
const settingsModalCss = fs.readFileSync(
  path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/SettingsModal.css'),
  'utf8',
);
const designSystemCss = fs.readFileSync(
  path.join(repoRoot, 'src/renderer/styles/design-system.css'),
  'utf8',
);
const contextUsageIndicator = fs.readFileSync(
  path.join(repoRoot, 'src/renderer/patterns/ContextUsageIndicator.tsx'),
  'utf8',
);
const contextBreakdownPopover = fs.readFileSync(
  path.join(repoRoot, 'src/renderer/patterns/ContextBreakdownPopover.tsx'),
  'utf8',
);

const requireCssContract = (condition, message) => {
  if (condition) return;
  console.error(`[fidelity] ${message}`);
  process.exit(1);
};

const cssBlock = (source, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? '';
};

const zIndexValue = (token) => {
  const match = designSystemCss.match(new RegExp(`--z-${token}:\\s*(\\d+);`));
  return Number(match?.[1] ?? Number.NaN);
};

requireCssContract(
  cssBlock(appShellCss, '.main-input-bar').includes('z-index: var(--z-sticky);'),
  'Composer must use --z-sticky so Settings can cover the complete input surface.',
);
requireCssContract(
  cssBlock(settingsModalCss, '.settings-modal-backdrop').includes('z-index: var(--z-modal-backdrop);'),
  'Settings backdrop must use --z-modal-backdrop.',
);
requireCssContract(
  cssBlock(settingsModalCss, '.settings-center').includes('z-index: var(--z-modal);'),
  'Settings surface must use --z-modal inside its backdrop stacking context.',
);

const zOrder = ['sticky', 'modal-backdrop', 'modal', 'tooltip', 'notification'].map(zIndexValue);
requireCssContract(
  zOrder.every(Number.isFinite) && zOrder.every((value, index) => index === 0 || zOrder[index - 1] < value),
  'Global stacking contract must remain composer < modal backdrop < modal < tooltip < notification.',
);
requireCssContract(
  contextUsageIndicator.includes("t('contextBreakdown.estimatedBadge')")
    && contextUsageIndicator.includes("t('contextBreakdown.lastBadge')")
    && contextUsageIndicator.includes("projection?.status === 'blocked'"),
  'Composer context ring must prioritize the next-request estimate and expose blocked projections.',
);
requireCssContract(
  contextBreakdownPopover.includes("t('contextBreakdown.estimatedNext')")
    && contextBreakdownPopover.includes("t('contextBreakdown.lastActual')")
    && contextBreakdownPopover.includes('estimated.willCompact'),
  'Context popover must separate Estimated from Last actual and disclose next-send compaction.',
);

console.log(
  `[fidelity] OK (baseline: ${baselineClasses.size} classes, ${baselineTestIds.size} testids; `
  + `added: +${addedClasses} classes, +${addedTestIds} testids allowed)`,
);
