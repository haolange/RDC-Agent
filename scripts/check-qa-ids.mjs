import fs from 'node:fs';
import path from 'node:path';

// Browser QA scripts and visual-diff scenarios address the UI by data-testid. Every id they use must still be
// rendered somewhere in src/renderer; ids nothing addresses are free to change.
const repoRoot = process.cwd();

const walk = (dir, accept, files = []) => {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, accept, files);
    else if (accept(entry.name)) files.push(fullPath);
  }
  return files;
};

const renderedPatterns = [
  /data-testid\s*=\s*"([^"]+)"/g,
  /data-testid\s*=\s*'([^']+)'/g,
  /data-testid\s*=\s*\{`([^`]+)`\}/g,
  /data-testid\s*=\s*\{\s*['"]([^'"]+)['"]\s*\}/g,
  /\b(?:data-testid|dataTestId)\s*=\s*\{[^{}?]+\?\s*['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]\s*\}/g,
  /dataTestId\s*=\s*["']([^"']+)["']/g,
  // Shared parts take the id as a prop or a default parameter (SettingsField, HandoffActionRow).
  /\btestId\s*=\s*["']([^"']+)["']/g,
  // ModalLayer names its overlay separately from the dialog.
  /\boverlayTestId\s*=\s*["']([^"']+)["']/g,
  /\btestId:\s*'([^']+)'/g,
  /\btestId:\s*`([^`]+)`/g,
];

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A template id such as `plan-card-${id}` matches any value in place of each interpolation. */
const idMatcher = (id) =>
  new RegExp(
    `^${id
      .split(/\$\{[^}]*\}/)
      .map(escapeRegExp)
      .join('.+')}$`,
  );

const rendered = new Set();
for (const filePath of walk(
  path.join(repoRoot, 'src/renderer'),
  (name) => /\.tsx?$/.test(name) && !name.includes('.test.'),
)) {
  const content = fs.readFileSync(filePath, 'utf8');
  for (const pattern of renderedPatterns) {
    for (const match of content.matchAll(pattern)) {
      for (const capture of match.slice(1)) if (capture?.trim()) rendered.add(capture.trim());
    }
  }
}
const matchers = [...rendered].map((id) => ({ id, exact: idMatcher(id) }));

const referencePatterns = [
  { pattern: /getByTestId\(\s*['"`]([^'"`$]+)['"`]/g, prefix: false },
  { pattern: /\[data-testid=\\?["']([^"'\\]+)\\?["']\]/g, prefix: false },
  { pattern: /\[data-testid\^=\\?["']([^"'\\]+)\\?["']\]/g, prefix: true },
  { pattern: /"testId"\s*:\s*"([^"]+)"/g, prefix: false },
];
const sources = [
  ...walk(path.join(repoRoot, 'scripts'), (name) => /^(qa|smoke)-.*\.mjs$/.test(name)),
  ...walk(path.join(repoRoot, 'scripts/visual-diff'), (name) => /\.(mjs|json)$/.test(name)),
];

const missing = [];
let referenceCount = 0;
for (const filePath of sources) {
  const content = fs.readFileSync(filePath, 'utf8');
  for (const { pattern, prefix } of referencePatterns) {
    for (const match of content.matchAll(pattern)) {
      const id = match[1];
      if (id.includes('${')) continue; // a harness template, not an id
      referenceCount += 1;
      const found = prefix
        ? [...rendered].some((renderedId) => renderedId.startsWith(id) || id.startsWith(renderedId.split('${')[0]))
        : matchers.some(({ exact }) => exact.test(id));
      if (!found) missing.push(`${path.relative(repoRoot, filePath)}: ${id}`);
    }
  }
}

if (missing.length) {
  console.error(`[qa-ids] ${missing.length} data-testid values used by QA are no longer rendered:`);
  for (const entry of [...new Set(missing)].sort()) console.error(`  - ${entry}`);
  process.exit(1);
}
console.log(`[qa-ids] OK (${referenceCount} references, ${rendered.size} rendered ids)`);
