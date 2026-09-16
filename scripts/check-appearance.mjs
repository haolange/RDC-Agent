import { createRequire } from 'module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scriptExists, scriptRead } from './renderer-contract.mjs';

const require = createRequire(import.meta.url);
require('./register-ts-source.cjs');

const {
  THEME_PRESET_CATALOG,
  THEME_PRESET_IDS,
  createDefaultChromeThemes,
  createDefaultUiPreferences,
  sanitizeUiPreferences,
  compileThemeChrome,
  serializeRdxThemeV1,
  parseRdxThemeV1,
  deriveComposeAccentVars,
  RDX_THEME_V1_PREFIX,
} = require('../src/shared/theme/index.ts');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const expectedPresets = [
  'rdc', 'absolutely', 'ayu', 'catppuccin', 'dracula', 'everforest', 'github', 'gruvbox', 'linear',
];
assert(JSON.stringify([...THEME_PRESET_IDS]) === JSON.stringify(expectedPresets), 'Preset catalog must match Codex-aligned + RDC list');
assert(
  THEME_PRESET_CATALOG.every((preset) => preset.light.presetId === preset.id && preset.dark.presetId === preset.id),
  'Preset chrome must self-identify',
);

const defaults = createDefaultUiPreferences();
assert(defaults.chromeThemes.light.presetId === 'rdc', 'Default light chrome is RDC');
assert(defaults.chromeThemes.dark.presetId === 'rdc', 'Default dark chrome is RDC');
assert(!('reduceMotion' in defaults), 'Removed motion preference must not persist in defaults');
assert(defaults.usePointerCursors === false, 'Pointer cursors remain opt-in');

const sanitized = sanitizeUiPreferences({
  theme: 'light',
  chromeThemes: {
    light: { accent: 'not-a-color', contrast: 999, presetId: 'nope' },
  },
});
assert(sanitized.theme === 'light', 'sanitize keeps valid theme');
assert(sanitized.chromeThemes.light.accent.startsWith('#'), 'invalid accent fails closed to hex');
assert(sanitized.chromeThemes.light.contrast === 100, 'contrast clamps to 100');
assert(sanitized.chromeThemes.light.presetId === 'rdc', 'unknown presetId fails closed to default');

const chrome = createDefaultChromeThemes().dark;
const vars = compileThemeChrome(chrome, 'dark');
assert(vars['--color-accent-500'], 'compiler emits accent-500');
assert(vars['--color-bg-1'], 'compiler emits surface bg-1');
assert(vars['--color-text-primary'], 'compiler emits ink');
assert(vars['--font-sans'], 'compiler emits ui font');
assert(vars['--color-surface-overlay'], 'compiler emits surface-overlay for popover chrome');
const lightVars = compileThemeChrome(createDefaultChromeThemes().light, 'light');
assert(lightVars['--color-surface-overlay'], 'light compiler emits surface-overlay');
assert(
  vars['--color-surface-overlay'] !== lightVars['--color-surface-overlay'],
  'dark/light surface-overlay must differ with chrome surface',
);

const encoded = serializeRdxThemeV1(chrome, 'dark');
assert(encoded.startsWith(RDX_THEME_V1_PREFIX), 'export uses rdx-theme-v1 prefix');
const parsed = parseRdxThemeV1(encoded, 'dark');
assert(parsed.ok, `import round-trip failed: ${parsed.error ?? ''}`);
assert(parsed.chrome.accent === chrome.accent, 'import preserves accent');

const rejected = parseRdxThemeV1('codex-theme-v1:{"variant":"dark"}');
assert(!rejected.ok, 'codex-theme-v1 must be rejected');

const composeDark = deriveComposeAccentVars('#33d1ff', 'dark');
const composeLight = deriveComposeAccentVars('#33d1ff', 'light');
assert(composeDark['--composer-mode-accent'] === '#33d1ff', 'compose accent preserved');
assert(composeDark['--composer-effort-fill-3'], 'compose effort fills derived');
assert(composeLight['--composer-effort-max-track'], 'light compose max track derived');
const effortFillLightness = (value) => {
  const match = String(value).match(/hsl\(\s*[\d.]+\s+[\d.]+%\s+([\d.]+)%\s*\)/i);
  return match ? Number(match[1]) : NaN;
};
const darkFill1L = effortFillLightness(composeDark['--composer-effort-fill-1']);
const darkFill5L = effortFillLightness(composeDark['--composer-effort-fill-5']);
const lightFill1L = effortFillLightness(composeLight['--composer-effort-fill-1']);
const lightFill5L = effortFillLightness(composeLight['--composer-effort-fill-5']);
assert(darkFill1L > darkFill5L, 'dark ordinary effort fills deepen with level (exclude Max): low light → high deep');
assert(lightFill1L > lightFill5L, 'light ordinary effort fills deepen with level (exclude Max): low light → high deep');
assert(
  /\/\s*0\.(3|4)\d*\s*\)/.test(String(composeDark['--composer-effort-max-track'])),
  'dark Max rail stays translucent so the pixel field remains readable',
);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const composerChromeSource = [
  fs.readFileSync(path.join(repoRoot, 'src/renderer/features/composer/composer-chrome-1.css'), 'utf8'),
  fs.readFileSync(path.join(repoRoot, 'src/renderer/features/composer/composer-chrome-3.css'), 'utf8'),
].join('\n');
assert(
  composerChromeSource.includes('.composer-shell:focus-within')
    && composerChromeSource.includes('.composer-shell:has([aria-expanded="true"])')
    && composerChromeSource.includes('.composer-shell.is-running:has([aria-expanded="true"])'),
  'Composer ring must stay on while a footer menu is expanded, not only :focus-within',
);

const checkboxTokenSource = scriptRead('src/renderer/styles/design-system.css');
const checkPillCss = fs.readFileSync(path.join(repoRoot, 'src/renderer/ui/CheckPill.css'), 'utf8');
const knowledgeSidebarCss = fs.readFileSync(
  path.join(repoRoot, 'src/renderer/features/knowledge/KnowledgeCenterModal/knowledge-center-sidebar.css'),
  'utf8',
);
assert(
  checkboxTokenSource.includes('--checkbox-checked-bg:       transparent;')
    && checkboxTokenSource.includes('--checkbox-check-color:      var(--token-text-heading);')
    && !checkboxTokenSource.includes('--checkbox-checked-bg:       var(--token-accent-primary);'),
  'Checkbox tokens must stay outline + ink, not accent fill',
);
assert(
  checkPillCss.includes('border-color: var(--checkbox-checked-border);')
    && checkPillCss.includes('background: var(--checkbox-checked-bg);')
    && !checkPillCss.includes('var(--token-accent-primary)'),
  'CheckPill box must share checkbox tokens and must not paint accent fill',
);
assert(
  !knowledgeSidebarCss.includes('--checkbox-checked-bg'),
  'Knowledge space rows must not restyle the checkbox checked box',
);

const effortPopupSource = scriptRead('src/renderer/features/composer/ComposerModelEffortPanel.tsx');
const effortControlSource = scriptRead('src/renderer/features/composer/useComposerEffortControl.ts');
const effortMaxFieldSource = scriptRead('src/renderer/features/composer/EffortMaxField.tsx');
const effortLayoutSource = scriptRead('src/renderer/features/composer/useEffortPopupLayout.ts');
const debuggerCssSource = [
  scriptRead('src/renderer/features/composer/composer-effort.css'),
  ...fs.readdirSync(path.join(repoRoot, 'src/renderer/features/composer'))
    .filter((name) => /^composer-effort-\d+\.css$/.test(name))
    .sort()
    .map((name) => fs.readFileSync(path.join(repoRoot, 'src/renderer/features/composer', name), 'utf8')),
].join('\n');
assert(
  debuggerCssSource.includes('.composer-model-effort-popup.is-picker')
    && debuggerCssSource.includes('max-height: min(32rem, calc(100vh - var(--space-16)))')
    && debuggerCssSource.includes('width: min(calc(var(--space-10) * 8), calc(100vw - var(--space-6)))'),
  'Model picker may grow to 32rem tall but must stay 320px wide',
);
assert(
  debuggerCssSource.includes('.composer-model-effort-mode-tip')
    && debuggerCssSource.includes('bottom: calc(100% + var(--space-6))')
    && debuggerCssSource.includes('border-radius: var(--radius-full)')
    && debuggerCssSource.includes('background: var(--token-bg-raised);')
    && debuggerCssSource.includes('box-shadow: var(--token-shadow-raised)')
    && !debuggerCssSource.includes('.composer-model-effort-mode-tip {\n  position: absolute;\n  top: calc(100%')
    && !debuggerCssSource.includes(".composer-model-effort-mode[data-mode='fast'] .composer-model-effort-mode-tip")
    && !debuggerCssSource.includes(".composer-model-effort-mode[data-mode='max-context'] .composer-model-effort-mode-tip"),
  'Fast/Max tips must be raised pills centered on the icons, not pinned cards growing into the panel',
);
assert(
  fs.readFileSync(path.join(repoRoot, 'src/renderer/features/composer/composer-chrome-2.css'), 'utf8')
    .includes('padding: var(--space-1) var(--space-1) var(--space-2) 0;'),
  'Model list must keep bottom padding so the last row is not clipped by the popup radius',
);
assert(
  !effortPopupSource.includes("'--composer-effort-stops-opacity'"),
  'Effort popup must not compete with the Max animation for stop opacity ownership',
);
assert(
  effortMaxFieldSource.includes(
    "assignDynStyle(host, { '--composer-effort-stops-opacity': stopsOpacity.toFixed(3) })",
  ),
  'Max animation must own stop opacity frame delivery',
);
assert(
  effortMaxFieldSource.includes('clearDynStyle(host)'),
  'Max animation must release imperative stop opacity on cleanup',
);
const trackObserveKeySource = effortControlSource.match(/const trackObserveKey = \[([\s\S]*?)\]\.join/)?.[1] ?? '';
assert(
  effortLayoutSource.includes('positionTransitionsReady')
    && effortLayoutSource.includes('requestAnimationFrame(() =>')
    && effortLayoutSource.includes('cancelSettleFrame')
    && effortPopupSource.includes('positionTransitionsReady')
    && effortPopupSource.includes('is-layout-stabilizing')
    && debuggerCssSource.includes('--composer-effort-position-duration: 0ms;')
    && debuggerCssSource.includes('left var(--composer-effort-position-duration')
    && debuggerCssSource.includes('transform var(--composer-effort-position-duration')
    && debuggerCssSource.includes('background var(--transition-fast)')
    && debuggerCssSource.includes('opacity var(--transition-fast)')
    && trackObserveKeySource.includes('displayLevelsKey'),
  'Effort layout measurement must settle before enabling position transitions while preserving color/opacity and Max lifecycle animations',
);
assert(!scriptExists('src/renderer/styles/themes/oklch-themes.css'), 'legacy oklch-themes.css must be removed');
assert(!scriptExists('src/renderer/styles/tokens/index.css'), 'legacy styles/tokens dual track must be removed');

const mainTsx = scriptRead('src/renderer/main.tsx');
assert(!mainTsx.includes('styles/tokens'), 'main.tsx must not import styles/tokens');
assert(mainTsx.includes('styles/global.css'), 'main.tsx imports global.css');

const types = scriptRead('src/renderer/features/settings/SettingsModal/types.ts');
assert(types.includes("'appearance'"), 'SettingsSection includes appearance');

const applyChromeThemeSource = scriptRead('src/renderer/app/theme/applyChromeTheme.ts');
assert(applyChromeThemeSource.includes('adoptedStyleSheets'), 'applyChromeTheme must use constructable stylesheets');
assert(applyChromeThemeSource.includes('replaceSync'), 'applyChromeTheme must replaceSync chrome CSS vars');
assert(!applyChromeThemeSource.includes("createElement('style')"), 'applyChromeTheme must not inject <style> textContent under CSP');
assert(!applyChromeThemeSource.includes('.style.colorScheme'), 'applyChromeTheme must not set inline style attributes under style-src-attr none');
assert(applyChromeThemeSource.includes('color-scheme:'), 'applyChromeTheme must declare color-scheme inside the constructable sheet');

const agentsMd = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');
assert(agentsMd.includes('Appearance'), 'AGENTS.md must document Appearance');
assert(agentsMd.includes('禁止恢复 translucent'), 'AGENTS.md must forbid translucent sidebar');

const designMd = fs.readFileSync(path.join(repoRoot, 'DESIGN.md'), 'utf8');
assert(designMd.includes('docs/ui/'), 'DESIGN.md must point Appearance/UI authority to docs/ui/');
assert(designMd.includes('style-src'), 'DESIGN.md must document CSP style-src for Appearance chrome');
assert(
  designMd.includes('schema 6') || designMd.includes('schemaVersion') || designMd.includes('chromeThemes'),
  'DESIGN.md must document Appearance chrome persistence / schema reset boundary',
);

const designSystemMd = fs.readFileSync(path.join(repoRoot, 'docs/ui/design-system.md'), 'utf8');
assert(designSystemMd.includes('rdx-theme-v1'), 'docs/ui/design-system.md must document rdx-theme-v1');
assert(designSystemMd.includes('chromeThemes'), 'docs/ui/design-system.md must document chromeThemes');

const workbenchUiMd = fs.readFileSync(path.join(repoRoot, 'docs/ui/workbench-and-transcript.md'), 'utf8');
assert(workbenchUiMd.includes('Appearance') || workbenchUiMd.includes('chrome'), 'workbench UI doc must reference Appearance chrome');

const appearanceSource = scriptRead('src/renderer/features/settings/SettingsModal/sections/AppearanceSettings.tsx');
const appearanceChromeParts = scriptRead('src/renderer/features/settings/SettingsModal/sections/AppearanceChromeParts.tsx');
assert(!appearanceSource.includes('appearance-preset-swatch'), 'Appearance must not keep a side-mounted preset Aa sibling');
assert(!appearanceChromeParts.includes('appearance-preset-swatch'), 'Chrome parts must not keep a side-mounted preset Aa sibling');
assert(appearanceChromeParts.includes('swatchColor'), 'Appearance preset options must supply swatchColor');
assert(appearanceChromeParts.includes('minMenuWidth={280}'), 'Appearance preset menu must set a wide minMenuWidth');
assert(appearanceChromeParts.includes('menuAlign="end"'), 'Appearance preset menu must right-align to the trigger');
assert(appearanceChromeParts.includes("from '../../../../ui/ColorField'"), 'Appearance must use shared ColorField');
assert(!appearanceChromeParts.includes('function ColorField'), 'Appearance must not inline a private ColorField');
assert(appearanceSource.includes('ChromeThemeCard'), 'Appearance page must compose ChromeThemeCard');
assert(scriptExists('src/renderer/ui/ColorField.tsx'), 'shared ColorField component must exist');
assert(scriptExists('src/renderer/ui/ColorField.css'), 'shared ColorField styles must exist');
const colorFieldSource = scriptRead('src/renderer/ui/ColorField.tsx');
const colorFieldCss = scriptRead('src/renderer/ui/ColorField.css');
assert(colorFieldSource.includes("layout?: 'grid' | 'inline'"), 'ColorField must support grid and inline layouts');
assert(colorFieldCss.includes('.color-field-swatch'), 'ColorField must expose a round swatch');
assert(!colorFieldCss.includes('.color-field-native'), 'ColorField must not fall back to the native OS color input');
assert(colorFieldSource.includes('ColorPickerSurface'), 'ColorField must open the self-drawn picker surface');
assert(colorFieldSource.includes("from './Popover'"), 'ColorField picker must be anchored by the shared Popover');
assert(scriptExists('src/renderer/ui/ColorPickerSurface.tsx'), 'self-drawn color picker surface must exist');
const colorPickerSource = scriptRead('src/renderer/ui/ColorPickerSurface.tsx');
assert(colorPickerSource.includes("role=\"slider\""), 'Color picker plane and hue rail must expose slider semantics');
assert(colorPickerSource.includes('onKeyDown={onAreaKeyDown}'), 'Color picker plane must be keyboard reachable');
assert(colorPickerSource.includes('onKeyDown={onHueKeyDown}'), 'Color picker hue rail must be keyboard reachable');
assert(colorFieldCss.includes('.color-field--inline'), 'ColorField must define inline layout for Agents look strip');
assert(!colorFieldCss.includes('--color-bg-'), 'ColorField CSS must use semantic tokens, not primitive --color-bg-*');
assert(
  /\.color-field-hex\s*\{[^}]*width:\s*9\.5ch/.test(colorFieldCss),
  'ColorField hex input must stay compact (#RRGGBB width), not stretch full rail',
);
assert(
  !/\.color-field-hex\s*\{[^}]*width:\s*100%/.test(colorFieldCss),
  'ColorField hex must not use width: 100%',
);
assert(colorFieldSource.includes('useDynStyle') || colorFieldSource.includes('assignDynStyle'), 'ColorField must use constructable dyn styles');

const dropdownTypes = scriptRead('src/renderer/ui/DropdownSelect/types.ts');
assert(dropdownTypes.includes('swatchColor'), 'DropdownOption must support swatchColor');
assert(dropdownTypes.includes('menuAlign'), 'DropdownSelect must support menuAlign');

const dropdownCss = scriptRead('src/renderer/ui/DropdownSelect/DropdownSelect.css');
const dropdownPrimitives = scriptRead('src/renderer/ui/DropdownSelect/DropdownSelectPrimitives.tsx');
assert(
  !/backdrop-filter:\s*blur|-webkit-backdrop-filter:\s*blur/.test(dropdownCss),
  'DropdownSelect must not use backdrop blur (restrained chrome uses solid surfaces)',
);
assert(
  /\.dropdown-select-menu\s*\{[^}]*background:\s*var\(--token-bg-shell\)/s.test(dropdownCss),
  'DropdownSelect menu must use a solid shell surface',
);
assert(
  dropdownCss.includes('dropdown-select-menu-caret'),
  'DropdownSelect menu must include a caret tip bridging the trigger',
);
assert(
  dropdownPrimitives.includes('dropdown-select-menu-caret'),
  'DropdownSelect menu markup must render the caret tip',
);
assert(dropdownPrimitives.includes('dropdown-select-option-check-icon'), 'DropdownSelect selected state must use a checkmark icon');
assert(!dropdownPrimitives.includes('●'), 'DropdownSelect must not use a bullet as the selected marker');

console.log('check:appearance passed');
