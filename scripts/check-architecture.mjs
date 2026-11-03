import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const fail = (message) => {
  console.error(`[architecture] ${message}`);
  process.exitCode = 1;
};

const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(path.join(repoRoot, relativePath));
const MOJIBAKE_PATTERNS = [
  /锛|銆|鈥|乄|丄|両|鐨|浣|璺|鍦|搴|闆|戠|€|鑼|鏈|浠|妗|浜|杈|鍚|鍏|鏂|瀹|绋|楠/,
  /鎵撳紑|澶嶅埗|鏈湴|鐘舶?侊細|璁剧疆|搴旂敤|鑿滎?崟|RenderDoc` `\.rdc` capture 鐨/,
];

const walk = (dir, files = [], filter = /\.(ts|tsx|js|jsx|md|css)$/) => {
  if (!fs.existsSync(dir)) {
    return files;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files, filter);
      continue;
    }
    if (filter.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
};

if (!exists('DESIGN.md')) fail('DESIGN.md is required as the UI/UX authority.');
if (!read('AGENTS.md').includes('DESIGN.md')) fail('AGENTS.md must link UI/UX to DESIGN.md.');
if (!exists('ARCHITECTURE.md')) {
  fail('ARCHITECTURE.md is required as the product and architecture authority.');
}

if (!read('AGENTS.md').includes('ARCHITECTURE.md')) {
  fail('AGENTS.md must link engineering iteration to ARCHITECTURE.md.');
}

if (!read('README.md').includes('ARCHITECTURE.md') || !read('docs/README.md').includes('ARCHITECTURE.md')) {
  fail('README.md and docs/README.md must include ARCHITECTURE.md in the reading path.');
}

// Legacy buckets: main/services + renderer/components (not renderer/services)
const sourceFiles = walk(path.join(repoRoot, 'src'));
for (const filePath of sourceFiles) {
  const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
  const content = fs.readFileSync(filePath, 'utf8');
  if (MOJIBAKE_PATTERNS.some((pattern) => pattern.test(content))) {
    fail(`${relativePath} contains mojibake text; restore readable UTF-8 copy before merging.`);
  }
  if (/from ['"].*src\/main\/services/.test(content)) {
    fail(`${relativePath} imports from main services technology bucket.`);
  }
  if (relativePath.startsWith('src/main/') && /from ['"].*\/services\//.test(content)) {
    fail(`${relativePath} imports from a main services technology bucket.`);
  }
  if (/from ['"].*src\/renderer\/components/.test(content) || /from ['"].*\/components\//.test(content)) {
    if (!relativePath.includes('node_modules')) {
      fail(`${relativePath} imports from a renderer components technology bucket.`);
    }
  }
}

for (const filePath of walk(path.join(repoRoot, 'docs'), [], /\.(md)$/)) {
  const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
  const content = fs.readFileSync(filePath, 'utf8');
  if (MOJIBAKE_PATTERNS.some((pattern) => pattern.test(content))) {
    fail(`${relativePath} contains mojibake text; restore readable UTF-8 copy before merging.`);
  }
}

for (const relativePath of ['README.md', 'AGENTS.md', 'ARCHITECTURE.md', 'DESIGN.md']) {
  if (!exists(relativePath)) continue;
  const content = read(relativePath);
  if (MOJIBAKE_PATTERNS.some((pattern) => pattern.test(content))) {
    fail(`${relativePath} contains mojibake text; restore readable UTF-8 copy before merging.`);
  }
}

if (exists('src/renderer/components')) {
  fail('Do not recreate src/renderer/components technology bucket.');
}

const preloadIndex = exists('src/preload/index.ts') ? read('src/preload/index.ts') : '';
if ((preloadIndex.match(/ipcRenderer\.invoke/g) ?? []).length > 5) {
  fail('src/preload/index.ts should compose domain API builders instead of defining the full API inline.');
}

const ipcHandlers = exists('src/main/ipc/handlers.ts') ? read('src/main/ipc/handlers.ts') : '';
if ((ipcHandlers.match(/ipcMain\.handle/g) ?? []).length > 10) {
  fail('src/main/ipc/handlers.ts should delegate to domain handler modules.');
}

const workbenchHandlers = exists('src/main/ipc/workbenchHandlers.ts') ? read('src/main/ipc/workbenchHandlers.ts') : '';
if ((workbenchHandlers.match(/ipcMain\.handle/g) ?? []).length > 0) {
  fail('src/main/ipc/workbenchHandlers.ts should remain a composition root; add channel handlers to a domain module.');
}

const browserFallback = exists('src/renderer/platform/browserElectronApi.ts')
  ? read('src/renderer/platform/browserElectronApi.ts')
  : '';
if (browserFallback.length > 12000) {
  fail('browserElectronApi.ts should be a small installer that delegates to browserFallback domain modules.');
}

const removedReasoningKeyPattern = new RegExp(`chat\\.reasoning${'Trace'}`, 'g');
const removedWorkBlockIdPattern = new RegExp([
  `co${'work-route'}`,
  `co${'work-reply'}`,
  `active-debug${'-reply'}`,
].join('|'), 'g');

const forbiddenAgentWorkbenchPatterns = [
  { pattern: /\u63a8\u7406\u8f68\u8ff9/g, message: 'Use "工作过程" / "Work process" for visible agent progress UI.' },
  { pattern: removedReasoningKeyPattern, message: 'Visible i18n keys must use chat.workProcess.' },
  { pattern: removedWorkBlockIdPattern, message: 'Conversation work blocks must not use removed pseudo-stage ids.' },
];
for (const filePath of sourceFiles) {
  const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
  const content = fs.readFileSync(filePath, 'utf8');
  for (const { pattern, message } of forbiddenAgentWorkbenchPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) {
      fail(`${relativePath} contains removed Agent Workbench wording or pseudo-stage id. ${message}`);
    }
  }
}

// R6 — renderer must not re-export symbols listed in shared-exports baseline
const rendererRoot = path.join(repoRoot, 'src/renderer');
const sharedExportsPath = path.join(repoRoot, 'scripts/fidelity/shared-exports.txt');
if (fs.existsSync(sharedExportsPath)) {
  const sharedSymbols = new Set(
    fs.readFileSync(sharedExportsPath, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean),
  );
  const exportTypeRe = /export\s+(?:type\s+)?(?:interface|type|enum)\s+([A-Za-z0-9_]+)/g;
  for (const filePath of walk(rendererRoot, [], /\.(ts|tsx)$/)) {
    const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
    if (!relativePath.startsWith('src/renderer/') || relativePath.includes('/node_modules/')) {
      continue;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    let match = exportTypeRe.exec(content);
    while (match) {
      if (sharedSymbols.has(match[1])) {
        fail(`R6: ${relativePath} re-exports shared symbol "${match[1]}". Import from @shared instead.`);
      }
      match = exportTypeRe.exec(content);
    }
  }
}

const settingsTypes = read('src/renderer/features/settings/SettingsModal/types.ts');
if (settingsTypes.includes("'diagnostics'")) {
  fail('SettingsSection must not restore diagnostics navigation.');
}
if (!settingsTypes.includes("'policy'")) {
  fail('SettingsSection must include peer policy navigation.');
}
const settingsNav = read('src/renderer/features/settings/SettingsModal/useSettingsModal.ts');
if (!settingsNav.includes("id: 'policy'") || settingsNav.includes("id: 'diagnostics'")) {
  fail('Settings nav must list Policy after Hooks and must not list Diagnostics.');
}
if (exists('src/renderer/features/debugger/RequestDiagnostics')
  || exists('src/renderer/features/settings/SettingsModal/sections/DeveloperDiagnosticsSettings.tsx')) {
  fail('Settings Diagnostics / RequestInspector frontend must remain removed.');
}
if (!exists('src/renderer/features/settings/SettingsModal/sections/PolicySettings.tsx')) {
  fail('PolicySettings peer section is required.');
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log('[architecture] OK');
