import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { scriptRead, scriptReadCssBundle } from './renderer-contract.mjs';

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

const appShellCss = scriptRead('src/renderer/styles/global/app-shell.css');
const composerChromeDir = path.join(repoRoot, 'src/renderer/features/composer');
const composerChromeCss = [
  scriptRead('src/renderer/features/composer/composer-chrome.css'),
  ...fs.readdirSync(composerChromeDir)
    .filter((name) => /^composer-chrome-\d+\.css$/.test(name))
    .sort()
    .map((name) => fs.readFileSync(path.join(composerChromeDir, name), 'utf8')),
].join('\n');
const settingsModalCss = scriptReadCssBundle('src/renderer/features/settings/SettingsModal/SettingsModal.css');
const designSystemCss = scriptRead('src/renderer/styles/design-system.css');
const contextUsageIndicator = scriptRead('src/renderer/patterns/ContextUsageIndicator.tsx');
const contextBreakdownPopover = scriptRead('src/renderer/patterns/ContextBreakdownPopover.tsx');
const contextRunMeterBand = scriptRead('src/renderer/patterns/ContextRunMeterBand.tsx');
const interactionPerformanceProbe = scriptRead('src/renderer/platform/performance/InteractionPerformanceProbe.ts');
const composerAgentMenu = scriptRead('src/renderer/features/composer/ComposerAgentMenu.tsx');

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
  contextUsageIndicator.includes("data-testid=\"composer-usage-indicator\"")
    && contextUsageIndicator.includes("t('contextBreakdown.preparing')")
    && contextUsageIndicator.includes("t('contextBreakdown.currentRequest')")
    && contextUsageIndicator.includes("t('contextBreakdown.lastActual')")
    && contextUsageIndicator.includes("t('contextBreakdown.projected')")
    && contextUsageIndicator.includes('is-estimated')
    && contextUsageIndicator.includes('composer-usage-value-number')
    && !contextUsageIndicator.includes('composer-usage-value-label')
    && !contextUsageIndicator.includes('preparingBadge')
    && !contextUsageIndicator.includes('NextRequestContextProjection')
    && !contextUsageIndicator.includes('composer-usage-ring-threshold')
    && !contextUsageIndicator.includes('thresholdRatio')
    && !contextUsageIndicator.includes('thresholdDashoffset'),
  'Composer context ring must stay percent-first; Preparing / Current request / Last actual / Projected live in title and popover, never as in-ring badges or draft-time prediction.',
);
requireCssContract(
  contextBreakdownPopover.includes("t('contextBreakdown.currentRequest')")
    && contextBreakdownPopover.includes("t('contextBreakdown.lastActual')")
    && contextBreakdownPopover.includes("t('contextBreakdown.projected')")
    && contextBreakdownPopover.includes("t('contextBreakdown.projectedNote')")
    && contextBreakdownPopover.includes("t('contextBreakdown.budgetNote.threshold'")
    && contextBreakdownPopover.includes("t('contextBreakdown.budgetNote.window'")
    && contextBreakdownPopover.includes("t('contextBreakdown.budgetNote.generatable'")
    && contextBreakdownPopover.includes('context-breakdown-window-note')
    && contextBreakdownPopover.includes('context-breakdown-bar-threshold')
    && contextBreakdownPopover.includes("t('contextBreakdown.noUsageYet')")
    && contextBreakdownPopover.includes('const showUsage = !showPrepared && usage !== null;')
    && contextBreakdownPopover.includes('className="context-breakdown-hero"')
    && contextBreakdownPopover.includes('className="context-breakdown-bar"')
    && contextBreakdownPopover.includes('prepared={showPrepared ? prepared : null}')
    && contextBreakdownPopover.includes('usage={showUsage ? usage : null}')
    && contextBreakdownPopover.includes('unavailable={!hasAuthoritativeBreakdown}')
    && !contextBreakdownPopover.includes('context-breakdown-preparing')
    && !contextBreakdownPopover.includes('context-breakdown-empty-state')
    && !contextBreakdownPopover.includes('showWindowPercent')
    && !contextBreakdownPopover.includes('context-breakdown-meter-eyebrow')
    && !contextBreakdownPopover.includes('context-breakdown-runtime')
    && contextRunMeterBand.includes('const metricUsage = isCurrent ? null : usage;')
    && contextRunMeterBand.includes("data-phase={isCurrent ? 'current' : usage ? 'actual' : 'unavailable'}")
    && (contextRunMeterBand.match(/data-testid="context-breakdown-run-meter"/g) || []).length === 1,
  'Context popover must keep one visual structure: Current renders the prepared Tokens/Cache/Reasoning strip; Preparing retains the last truthful usage when available; no telemetry remains explicit as unavailable; internal runtime diagnostics stay absent.',
);
requireCssContract(
  interactionPerformanceProbe.includes("get(PERFORMANCE_QUERY_KEY) !== '1') return")
    && interactionPerformanceProbe.includes("PerformanceObserver.supportedEntryTypes.includes('event')")
    && interactionPerformanceProbe.includes('durationThreshold: EVENT_TIMING_THRESHOLD_MS')
    && interactionPerformanceProbe.includes("PerformanceObserver.supportedEntryTypes.includes('longtask')")
    && !interactionPerformanceProbe.includes('window.requestAnimationFrame')
    && !interactionPerformanceProbe.includes('window.setTimeout')
    && interactionPerformanceProbe.includes('data-rdc-qa-performance'),
  'Composer performance QA must remain query-gated and expose native Event Timing click-to-next-paint plus long-task metrics without timer/RAF proxies.',
);

requireCssContract(
  composerAgentMenu.includes("isSelected ? ' is-selected' : ''")
    && composerAgentMenu.includes("isRunning ? ' is-running' : ''")
    && composerAgentMenu.includes('role="menuitemradio"')
    && composerAgentMenu.includes('aria-checked={isSelected}')
    && composerAgentMenu.includes("t('chat.workProcessStatusRunning')")
    && composerAgentMenu.includes('composer-agent-menu-item-running-state')
    && composerAgentMenu.includes('composer-agent-menu-item-running-dot')
    && composerAgentMenu.includes('composer-agent-menu-item-check')
    && composerChromeCss.includes('.composer-agent-menu-item.is-selected')
    && cssBlock(composerChromeCss, '.composer-agent-menu-item-running-dot').includes('width: var(--space-2);')
    && cssBlock(composerChromeCss, '.composer-agent-menu-item-running-dot').includes('height: var(--space-2);')
    && composerChromeCss.includes('@media (prefers-reduced-motion: reduce)')
    && composerChromeCss.includes('.composer-agent-menu-item-running-dot {\n    animation: none;'),
  'Agent menu must keep selected and session-scoped running states separate, accessible, compact, localized, and reduced-motion safe.',
);

const contextMetricResponsiveStart = appShellCss.indexOf('@container (max-width: 33rem)');
const contextMetricResponsiveEnd = appShellCss.indexOf('/* Details disclosure toggle */', contextMetricResponsiveStart);
const contextMetricResponsiveCss = contextMetricResponsiveStart >= 0 && contextMetricResponsiveEnd > contextMetricResponsiveStart
  ? appShellCss.slice(contextMetricResponsiveStart, contextMetricResponsiveEnd)
  : '';
const heroOnlyResponsiveStart = appShellCss.indexOf('@container (max-width: 42rem)');
const heroOnlyResponsiveCss = heroOnlyResponsiveStart >= 0 && contextMetricResponsiveStart > heroOnlyResponsiveStart
  ? appShellCss.slice(heroOnlyResponsiveStart, contextMetricResponsiveStart)
  : '';
requireCssContract(
  cssBlock(appShellCss, '.context-breakdown-run-columns').includes('grid-template-columns: repeat(3, minmax(0, 1fr));')
    && cssBlock(appShellCss, '.context-breakdown-run-columns').includes('gap: var(--space-3);')
    && cssBlock(appShellCss, '.context-breakdown-run-col').includes('border: 1px solid var(--token-border-card);')
    && cssBlock(appShellCss, '.context-breakdown-run-col').includes('border-radius: var(--radius-lg);')
    && cssBlock(appShellCss, '.context-breakdown-run-col').includes('background: var(--token-bg-panel);')
    && contextMetricResponsiveCss.includes('grid-template-columns: minmax(0, 1fr);')
    && !appShellCss.includes('border-inline-start')
    && !appShellCss.includes('column-gap: clamp(0px')
    && !heroOnlyResponsiveCss.includes('grid-template-columns: minmax(0, 1fr);')
    && !heroOnlyResponsiveCss.includes('flex-wrap: wrap;'),
  'Context Usage metrics must be equal-width cards in one row above 33rem; only the narrow metric query may stack them.',
);

console.log(
  `[fidelity] OK (baseline: ${baselineClasses.size} classes, ${baselineTestIds.size} testids; `
  + `added: +${addedClasses} classes, +${addedTestIds} testids allowed)`,
);
