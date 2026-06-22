import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const sharedRoot = path.join(repoRoot, 'src/shared');
const outPath = path.resolve(repoRoot, process.argv[2] ?? 'scripts/fidelity/shared-exports.txt');

const EXPORT_RE = /^\s*export\s+(?:type\s+)?(?:\{([^}]+)\}|(?:type\s+)?([\w$]+)(?:\s*,\s*([\w$]+))*)\s*(?:from|;)/;

const parseNamedExports = (line) => {
  const names = [];
  const braceMatch = line.match(/export\s*\{([^}]+)\}/);
  if (braceMatch) {
    for (const part of braceMatch[1].split(',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const alias = trimmed.split(/\s+as\s+/);
      names.push((alias[1] ?? alias[0]).trim());
    }
    return names;
  }
  const typeStar = line.match(/export\s+type\s+\*\s+from/);
  if (typeStar) return ['*'];
  const star = line.match(/export\s+\*\s+from/);
  if (star) return ['*'];
  const declaration = line.match(/export\s+(?:type|interface|class|const|let|var|function|enum)\s+([\w$]+)/);
  if (declaration && !line.includes(' from ')) {
    names.push(declaration[1]);
    return names;
  }
  const single = line.match(/export\s+(?:type\s+)?([\w$]+)/);
  if (single && !line.includes(' from ')) {
    names.push(single[1]);
  }
  return names;
};

const walk = (dir, files = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }
  return files;
};

const symbols = new Set();

for (const filePath of walk(sharedRoot)) {
  const relative = path.relative(sharedRoot, filePath).replace(/\\/g, '/');
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  for (const line of lines) {
    if (!/^\s*export\b/.test(line)) continue;
    if (/export\s+default\b/.test(line)) {
      symbols.add(`${relative}::default`);
      continue;
    }
    for (const name of parseNamedExports(line)) {
      if (name === '*') {
        symbols.add(`${relative}::*`);
      } else {
        symbols.add(name);
      }
    }
  }
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
const sorted = [...symbols].sort((a, b) => a.localeCompare(b));
fs.writeFileSync(outPath, `${sorted.join('\n')}\n`, 'utf8');
console.log(`[shared:extract] exports: ${sorted.length} -> ${path.relative(repoRoot, outPath)}`);
