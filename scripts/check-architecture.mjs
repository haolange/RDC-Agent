import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const fail = (message) => {
  console.error(`[architecture] ${message}`);
  process.exitCode = 1;
};

const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(path.join(repoRoot, relativePath));
const lineCount = (filePath) => fs.readFileSync(filePath, 'utf8').split('\n').length;
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

const countLines = (filePath) => {
  if (!fs.existsSync(filePath)) return 0;
  return lineCount(filePath);
};

if (!exists('DESIGN.md')) {
  fail('DESIGN.md is required as the product and architecture authority.');
}

if (!read('AGENTS.md').includes('DESIGN.md')) {
  fail('AGENTS.md must link UI/UX and architecture iteration to DESIGN.md.');
}

if (!read('README.md').includes('DESIGN.md') || !read('docs/README.md').includes('DESIGN.md')) {
  fail('README.md and docs/README.md must include DESIGN.md in the reading path.');
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

for (const relativePath of ['README.md', 'AGENTS.md', 'DESIGN.md']) {
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

const r1ComponentExempt = new Set([
  'src/renderer/features/settings/SettingsModal/index.tsx',
]);

// R1 — file line budgets (renderer)
const rendererRoot = path.join(repoRoot, 'src/renderer');
for (const filePath of walk(rendererRoot, [], /\.(tsx|ts)$/)) {
  const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
  const lines = countLines(filePath);
  if (filePath.endsWith('.tsx') && lines > 300 && !r1ComponentExempt.has(relativePath)) {
    fail(`R1: ${relativePath} has ${lines} lines (component budget 300).`);
  }
  if (relativePath.includes('/hooks/') && filePath.endsWith('.ts') && lines > 200) {
    fail(`R1: ${relativePath} has ${lines} lines (hook budget 200).`);
  }
  const featureUseHook = /^src\/renderer\/features\/.*\/use[^/]+\.ts$/.test(relativePath);
  if (featureUseHook && lines > 200) {
    fail(`R1: ${relativePath} has ${lines} lines (feature use-hook budget 200).`);
  }
  if (relativePath.startsWith('src/renderer/services/') && filePath.endsWith('.ts') && lines > 200) {
    fail(`R1: ${relativePath} has ${lines} lines (service budget 200).`);
  }
  if (relativePath.startsWith('src/renderer/stores/') && filePath.endsWith('.ts') && lines > 200) {
    fail(`R1: ${relativePath} has ${lines} lines (store budget 200).`);
  }
}

// R2 — dependency direction (import path heuristics)
const importFrom = (content) => {
  const paths = [];
  const re = /from\s+['"]([^'"]+)['"]/g;
  let match = re.exec(content);
  while (match) {
    paths.push(match[1]);
    match = re.exec(content);
  }
  return paths;
};

const resolvesUnder = (importPath, prefix) => importPath.includes(prefix);

for (const filePath of walk(rendererRoot, [], /\.(tsx|ts)$/)) {
  const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
  const content = fs.readFileSync(filePath, 'utf8');
  const imports = importFrom(content);

  if (relativePath.startsWith('src/renderer/ui/')) {
    for (const imp of imports) {
      if (resolvesUnder(imp, '/features/') || resolvesUnder(imp, '/stores/') || imp.includes('/stores/')
        || resolvesUnder(imp, '/platform/') || imp.includes('/hooks/') || imp.includes('/app/') || imp.includes('/shell/')) {
          if (!imp.startsWith('.') && !imp.startsWith('@shared')) {
            fail(`R2: ${relativePath} must not import ${imp}`);
          }
          if (imp.includes('/features/') || imp.includes('/stores/') || imp.includes('/platform/') || imp.includes('/app/') || imp.includes('/shell/')) {
            fail(`R2: ui layer violation in ${relativePath} -> ${imp}`);
          }
        }
    }
  }

  if (relativePath.startsWith('src/renderer/services/')) {
    if (/from\s+['"]react['"]/.test(content) || /from\s+['"]react-dom['"]/.test(content)) {
      fail(`R2: ${relativePath} must not import React.`);
    }
    for (const imp of imports) {
      if (imp.includes('/features/') || imp.includes('/ui/') || imp.includes('/stores/') || imp.includes('/platform/')) {
        fail(`R2: services layer violation in ${relativePath} -> ${imp}`);
      }
    }
  }
}

const allowsElectronApi = (relativePath) => (
  relativePath.startsWith('src/renderer/platform/')
  || relativePath.includes('/bootstrap/')
  || relativePath.startsWith('src/renderer/hooks/')
  || relativePath.startsWith('src/renderer/stores/')
  || relativePath.startsWith('src/renderer/app/')
  || /^src\/renderer\/features\/.*\/use[^/]+\.ts$/.test(relativePath)
  || /^src\/renderer\/features\/.*\.ts$/.test(relativePath)
  || relativePath.startsWith('src/renderer/pages/')
  || relativePath.startsWith('src/renderer/features/settings/')
  || relativePath.startsWith('src/renderer/ui/')
);

// R3 — window.electronAPI layering (stores + feature data hooks + platform)
for (const filePath of walk(rendererRoot, [], /\.(tsx|ts)$/)) {
  const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes('window.electronAPI')) continue;
  if (!allowsElectronApi(relativePath)) {
    fail(`R3: ${relativePath} must not reference window.electronAPI (use platform/ or a feature data hook).`);
  }
}

// R4 — hardcoded hex in TSX inline styles and renderer CSS (tokens/design-system exempt)
const r4CssExempt = (relativePath) => (
  relativePath.startsWith('src/renderer/styles/tokens/')
  || relativePath === 'src/renderer/styles/design-system.css'
  || relativePath === 'src/renderer/features/debugger/AgentChat/AgentChat.css'
  || relativePath === 'src/renderer/patterns/EmptyWorkbenchPrompt/EmptyWorkbenchPrompt.css'
  || relativePath.startsWith('src/renderer/styles/global/')
);

for (const filePath of walk(rendererRoot, [], /\.(tsx|css)$/)) {
  const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
  const content = fs.readFileSync(filePath, 'utf8');
  if (filePath.endsWith('.tsx') && /style=\{\{[^}]*#[0-9a-fA-F]{3,8}/.test(content)) {
    fail(`R4: ${relativePath} uses inline hex color.`);
  }
  if (filePath.endsWith('.css') && !r4CssExempt(relativePath) && /#[0-9a-fA-F]{3,8}\b/.test(content)) {
    fail(`R4: ${relativePath} uses hardcoded hex color (use design tokens).`);
  }
}

// R6 — renderer must not re-export symbols listed in shared-exports baseline
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

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log('[architecture] OK');
