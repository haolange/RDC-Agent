import fs from 'node:fs';
import path from 'node:path';

// Extracts the renderer's data-testid contract: Browser QA scripts and SSR tests address the UI by
// these ids, so removing one is a breaking change. Class names and CSS are free to change.
const repoRoot = process.cwd();
const rendererRoot = path.join(repoRoot, 'src/renderer');
const outDir = path.resolve(repoRoot, process.argv[2] ?? 'scripts/fidelity');

const walkTsx = (dir, files = []) => {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTsx(fullPath, files);
    else if (entry.name.endsWith('.tsx')) files.push(fullPath);
  }
  return files;
};

const testIdPatterns = [
  /data-testid\s*=\s*"([^"]+)"/g,
  /data-testid\s*=\s*'([^']+)'/g,
  /data-testid\s*=\s*\{`([^`]+)`\}/g,
  /data-testid\s*=\s*\{\s*['"]([^'"]+)['"]\s*\}/g,
  /\b(?:data-testid|dataTestId)\s*=\s*\{[^{}?]+\?\s*['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]\s*\}/g,
  /dataTestId\s*=\s*"([^"]+)"/g,
  /dataTestId\s*=\s*'([^']+)'/g,
  // Shared parts take the id as a prop (SettingsField, SettingsDiagnostics, ResourceTrustBlock).
  /\btestId\s*=\s*"([^"]+)"/g,
  /\btestId:\s*'([^']+)'/g,
  /\btestId:\s*`([^`]+)`/g,
];

const testIds = new Set();
for (const filePath of walkTsx(rendererRoot)) {
  const content = fs.readFileSync(filePath, 'utf8');
  for (const pattern of testIdPatterns) {
    for (const match of content.matchAll(pattern)) {
      for (const capture of match.slice(1)) {
        const value = capture?.trim();
        if (value) testIds.add(value);
      }
    }
  }
}

fs.mkdirSync(outDir, { recursive: true });
const testOut = path.join(outDir, 'fidelity-testids.txt');
const sortedTestIds = [...testIds].sort((a, b) => a.localeCompare(b));
fs.writeFileSync(testOut, `${sortedTestIds.join('\n')}\n`, 'utf8');
console.log(`[fidelity:extract] test ids: ${sortedTestIds.length} -> ${path.relative(repoRoot, testOut)}`);
