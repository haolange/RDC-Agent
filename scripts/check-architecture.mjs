import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const fail = (message) => {
  console.error(`[architecture] ${message}`);
  process.exitCode = 1;
};

const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(path.join(repoRoot, relativePath));
const walk = (dir, files = []) => {
  if (!fs.existsSync(dir)) {
    return files;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    if (/\.(ts|tsx|js|jsx|md)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
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

const sourceFiles = walk(path.join(repoRoot, 'src'));
for (const filePath of sourceFiles) {
  const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
  const content = fs.readFileSync(filePath, 'utf8');
  if (/from ['"].*src\/main\/services/.test(content) || /from ['"].*\/services\//.test(content)) {
    fail(`${relativePath} imports from a main services technology bucket.`);
  }
  if (/from ['"].*src\/renderer\/components/.test(content) || /from ['"].*\/components\//.test(content)) {
    fail(`${relativePath} imports from a renderer components technology bucket.`);
  }
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

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log('[architecture] OK');
