import { createRequire } from 'module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scriptExists, scriptRead, scriptReadCssBundle } from './renderer-contract.mjs';
import './check-component-catalog.mjs';

const require = createRequire(import.meta.url);
require('./register-ts-source.cjs');

const {
  THEME_PRESET_CATALOG,
  THEME_PRESET_IDS,
  createDefaultChromeThemes,
  createDefaultUiPreferences,
  sanitizeUiPreferences,
  compileThemeChrome,
  serializeRdcTheme,
  parseRdcTheme,
  deriveComposeAccentVars,
  RDC_THEME_PREFIX,
} = require('../src/shared/theme/index.ts');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const expectedPresets = [
  'rdc',
  'absolutely',
  'ayu',
  'catppuccin',
  'dracula',
  'everforest',
  'github',
  'gruvbox',
  'linear',
];
assert(
  JSON.stringify([...THEME_PRESET_IDS]) === JSON.stringify(expectedPresets),
  'Preset catalog must match Codex-aligned + RDC list',
);
assert(
  THEME_PRESET_CATALOG.every((preset) => preset.light.presetId === preset.id && preset.dark.presetId === preset.id),
  'Preset chrome must self-identify',
);

const defaults = createDefaultUiPreferences();
assert(defaults.chromeThemes.light.presetId === 'rdc', 'Default light chrome is RDC');
assert(defaults.chromeThemes.dark.presetId === 'rdc', 'Default dark chrome is RDC');
assert(!('reduceMotion' in defaults), 'Removed motion preference must not persist in defaults');
assert(
  !('usePointerCursors' in defaults),
  'Interactive controls always use the pointer cursor; there is no preference for it',
);

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
assert(vars['--font-sans'] === undefined, 'default chrome leaves the bundled font stack to design-tokens.css');
assert(
  compileThemeChrome({ ...chrome, fonts: { ui: 'Custom UI', code: null } }, 'dark')['--font-sans'] === 'Custom UI',
  'a chosen UI font overrides the default stack',
);
assert(vars['--color-surface-overlay'], 'compiler emits surface-overlay for popover chrome');
const lightVars = compileThemeChrome(createDefaultChromeThemes().light, 'light');
assert(lightVars['--color-surface-overlay'], 'light compiler emits surface-overlay');
assert(
  vars['--color-surface-overlay'] !== lightVars['--color-surface-overlay'],
  'dark/light surface-overlay must differ with chrome surface',
);

const encoded = serializeRdcTheme(chrome, 'dark');
assert(encoded.startsWith(RDC_THEME_PREFIX), 'export uses rdc-theme prefix');
const parsed = parseRdcTheme(encoded, 'dark');
assert(parsed.ok, `import round-trip failed: ${parsed.error ?? ''}`);
assert(parsed.chrome.accent === chrome.accent, 'import preserves accent');

const rejected = parseRdcTheme('codex-theme-v1:{"variant":"dark"}');
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
const composerChromeSource = scriptReadCssBundle('src/renderer/features/composer/composer-chrome.css');
const knowledgeSidebarCss = fs.readFileSync(
  path.join(repoRoot, 'src/renderer/features/knowledge/KnowledgeCenterModal/knowledge-center-sidebar.css'),
  'utf8',
);
assert(
  !knowledgeSidebarCss.includes('--checkbox-checked-bg'),
  'Knowledge space rows must not restyle the checkbox checked box',
);

const effortPopupSource = scriptRead('src/renderer/features/composer/ComposerModelEffortPanel.tsx');
{
  // The last row must clear the popup radius: the list's bottom padding is at least --space-2.
  const listPadding =
    composerChromeSource
      .match(/\.composer-model-list \{[^}]*?\bpadding:\s*([^;]+);/u)?.[1]
      .trim()
      .split(/\s+/u) ?? [];
  const bottom = listPadding[listPadding.length === 4 || listPadding.length === 3 ? 2 : 0];
  assert(
    /^var\(--space-(?:[2-9]|1[0-9])\)$/u.test(bottom ?? ''),
    'Model list must keep bottom padding so the last row is not clipped by the popup radius',
  );
}
assert(
  !effortPopupSource.includes("'--composer-effort-stops-opacity'"),
  'Effort popup must not compete with the Max animation for stop opacity ownership',
);
assert(!scriptExists('src/renderer/styles/themes/oklch-themes.css'), 'legacy oklch-themes.css must be removed');
assert(!scriptExists('src/renderer/styles/tokens/index.css'), 'legacy styles/tokens dual track must be removed');

const mainTsx = scriptRead('src/renderer/main.tsx');
assert(!mainTsx.includes('styles/tokens'), 'main.tsx must not import styles/tokens');

const applyChromeThemeSource = scriptRead('src/renderer/app/theme/applyChromeTheme.ts');
assert(
  !applyChromeThemeSource.includes("createElement('style')"),
  'applyChromeTheme must not inject <style> textContent under CSP',
);
assert(
  !applyChromeThemeSource.includes('.style.colorScheme'),
  'applyChromeTheme must not set inline style attributes under style-src-attr none',
);

const appearanceSource = scriptRead('src/renderer/features/settings/SettingsModal/sections/AppearanceSettings.tsx');
const appearanceChromeParts = scriptRead(
  'src/renderer/features/settings/SettingsModal/sections/AppearanceChromeParts.tsx',
);
assert(
  !appearanceSource.includes('appearance-preset-swatch'),
  'Appearance must not keep a side-mounted preset Aa sibling',
);
assert(
  !appearanceChromeParts.includes('appearance-preset-swatch'),
  'Chrome parts must not keep a side-mounted preset Aa sibling',
);
// Both theme previews select one editor independently of the application display mode.
assert(
  !fs.existsSync(path.join(repoRoot, 'src/renderer/features/settings/SettingsModal/sections/AppearancePresetRow.tsx')),
  'The preset-tile row that folded the editors away is retired',
);
assert(!appearanceSource.includes('usePointerCursors'), 'The pointer cursor preference is retired');
assert(!appearanceChromeParts.includes('function ColorField'), 'Appearance must not inline a private ColorField');
assert(scriptExists('src/renderer/ui/ColorField.tsx'), 'shared ColorField component must exist');
assert(scriptExists('src/renderer/ui/ColorField.css'), 'shared ColorField styles must exist');
const colorFieldCss = scriptRead('src/renderer/ui/ColorField.css');
assert(!colorFieldCss.includes('.color-field-native'), 'ColorField must not fall back to the native OS color input');
assert(scriptExists('src/renderer/ui/ColorPickerSurface.tsx'), 'self-drawn color picker surface must exist');
assert(!colorFieldCss.includes('--color-bg-'), 'ColorField CSS must use semantic tokens, not primitive --color-bg-*');
assert(
  /\.color-field-hex\s*\{[^}]*width:\s*9\.5ch/.test(colorFieldCss),
  'ColorField hex input must stay compact (#RRGGBB width), not stretch full rail',
);
assert(!/\.color-field-hex\s*\{[^}]*width:\s*100%/.test(colorFieldCss), 'ColorField hex must not use width: 100%');

const dropdownCss = scriptRead('src/renderer/ui/Select/Select.css');
const dropdownPrimitives = scriptRead('src/renderer/ui/Select/SelectPrimitives.tsx');
assert(
  !/backdrop-filter:\s*blur|-webkit-backdrop-filter:\s*blur/.test(dropdownCss),
  'Select must not use backdrop blur (restrained chrome uses solid surfaces)',
);
assert(
  /\.dropdown-select-menu\s*\{[^}]*background:\s*var\(--token-bg-shell\)/s.test(dropdownCss),
  'Select menu must use a solid shell surface',
);
assert(!dropdownPrimitives.includes('●'), 'Select must not use a bullet as the selected marker');

// Keep the shared component path authoritative for ordinary configuration disclosure.
for (const file of [
  'src/renderer/features/settings/SettingsModal/sections/RdcCliInvokerSettingsFields.tsx',
  'src/renderer/features/settings/SettingsModal/sections/LocalToolDisclosure.tsx',
]) {
  const source = scriptRead(file);
  assert(!/<details\b|<select\b/.test(source), `${file} must not restore native unstyled controls`);
}
// Ids, paths, protocols and hashes never sit on a settings surface; they leave through one copy action.
for (const file of [
  'src/renderer/features/settings/SettingsModal/sections/ProviderConnectDialog.tsx',
  'src/renderer/features/settings/SettingsModal/sections/McpServicesPanel.tsx',
  'src/renderer/features/settings/SettingsModal/sections/HooksSettings.tsx',
]) {
  const source = scriptRead(file);
  assert(
    /<CopyDiagnosticsMenu\b|\buseCopyDiagnostics\(/.test(source) &&
      !/SettingsDiagnostics|summary=\{labels\.diagnostics\}/.test(source),
    `${file} must expose object diagnostics from its actions menu`,
  );
  assert(!/<details\b|<select\b/.test(source), `${file} must not restore native unstyled controls`);
}
assert(
  !scriptExists('designs/rdc-agent-design-system/Design System Preview.html'),
  'Duplicated HTML preview must remain retired',
);
const settingsShell = scriptRead('src/renderer/features/settings/SettingsModal/sections/settings-shell.css');
assert(
  !settingsShell.includes('aspect-ratio') && !/height:[^;]*100vw/.test(settingsShell),
  'Settings height must be independent of width',
);

console.log('check:appearance passed');
