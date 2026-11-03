import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const rulesDir = path.join(repoRoot, 'scripts/invariants');
const fail = (message) => {
  console.error(`[invariants] ${message}`);
  process.exitCode = 1;
};

const walk = (dir, extensions, files = []) => {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(fullPath, extensions, files);
      continue;
    }
    if (extensions.some((extension) => entry.name.endsWith(extension))) files.push(fullPath);
  }
  return files;
};

const rules = fs.readdirSync(rulesDir).filter((name) => name.endsWith('.json')).sort();
if (rules.length === 0) fail('scripts/invariants has no rules.');

for (const fileName of rules) {
  const rule = JSON.parse(fs.readFileSync(path.join(rulesDir, fileName), 'utf8'));
  const pattern = new RegExp(rule.pattern, rule.flags ?? '');
  const extensions = rule.extensions ?? ['.ts', '.tsx', '.js', '.mjs', '.css', '.md'];
  const exclude = new Set((rule.exclude ?? []).map((item) => item.replace(/\\/g, '/')));
  for (const root of rule.roots ?? ['src']) {
    for (const filePath of walk(path.join(repoRoot, root), extensions)) {
      const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
      if (exclude.has(relativePath)) continue;
      const content = fs.readFileSync(filePath, 'utf8');
      pattern.lastIndex = 0;
      if (pattern.test(content)) {
        fail(`${rule.id}: ${relativePath} ${rule.message}`);
      }
    }
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`[invariants] OK (${rules.length} rules)`);
