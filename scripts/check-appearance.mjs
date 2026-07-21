import { createRequire } from 'module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
assert(defaults.reduceMotion === 'system', 'Default reduceMotion is system');
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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assert(!fs.existsSync(path.join(repoRoot, 'src/renderer/styles/themes/oklch-themes.css')), 'legacy oklch-themes.css must be removed');
assert(!fs.existsSync(path.join(repoRoot, 'src/renderer/styles/tokens/index.css')), 'legacy styles/tokens dual track must be removed');

const mainTsx = fs.readFileSync(path.join(repoRoot, 'src/renderer/main.tsx'), 'utf8');
assert(!mainTsx.includes('styles/tokens'), 'main.tsx must not import styles/tokens');
assert(mainTsx.includes('styles/global.css'), 'main.tsx imports global.css');

const types = fs.readFileSync(path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/types.ts'), 'utf8');
assert(types.includes("'appearance'"), 'SettingsSection includes appearance');

const agentsMd = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');
assert(agentsMd.includes('Appearance'), 'AGENTS.md must document Appearance');
assert(agentsMd.includes('禁止恢复 translucent'), 'AGENTS.md must forbid translucent sidebar');

const designMd = fs.readFileSync(path.join(repoRoot, 'DESIGN.md'), 'utf8');
assert(designMd.includes('rdx-theme-v1'), 'DESIGN.md must document rdx-theme-v1');
assert(designMd.includes('chromeThemes'), 'DESIGN.md must document chromeThemes');
assert(designMd.includes('unified'), 'DESIGN.md must document unified preset trigger');

const appearanceSource = fs.readFileSync(
  path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/sections/AppearanceSettings.tsx'),
  'utf8',
);
assert(!appearanceSource.includes('appearance-preset-swatch'), 'Appearance must not keep a side-mounted preset Aa sibling');
assert(appearanceSource.includes('swatchColor'), 'Appearance preset options must supply swatchColor');
assert(appearanceSource.includes('minMenuWidth={280}'), 'Appearance preset menu must set a wide minMenuWidth');
assert(appearanceSource.includes('menuAlign="end"'), 'Appearance preset menu must right-align to the trigger');

const dropdownTypes = fs.readFileSync(path.join(repoRoot, 'src/renderer/ui/DropdownSelect/types.ts'), 'utf8');
assert(dropdownTypes.includes('swatchColor'), 'DropdownOption must support swatchColor');
assert(dropdownTypes.includes('menuAlign'), 'DropdownSelect must support menuAlign');

const dropdownCss = fs.readFileSync(
  path.join(repoRoot, 'src/renderer/ui/DropdownSelect/DropdownSelect.css'),
  'utf8',
);
const dropdownPrimitives = fs.readFileSync(
  path.join(repoRoot, 'src/renderer/ui/DropdownSelect/DropdownSelectPrimitives.tsx'),
  'utf8',
);
assert(
  /\.dropdown-select-menu\s*\{[^}]*backdrop-filter:\s*blur\(/s.test(dropdownCss),
  'DropdownSelect menu must use frosted-glass blur by default',
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
