import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const rendererRoot = path.join(repoRoot, 'src/renderer');
const outDir = path.resolve(repoRoot, process.argv[2] ?? 'scripts/fidelity');

const walkTsx = (dir, files = []) => {
  if (!fs.existsSync(dir)) {
    return files;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTsx(fullPath, files);
      continue;
    }
    if (entry.name.endsWith('.tsx')) {
      files.push(fullPath);
    }
  }
  return files;
};

const extractFromStringLiteral = (content, patterns) => {
  const found = new Set();
  for (const pattern of patterns) {
    let match = pattern.exec(content);
    while (match) {
      const value = match[1]?.trim();
      if (value) {
        for (const token of value.split(/\s+/)) {
          const normalized = token.trim();
          if (normalized) {
            found.add(normalized);
          }
        }
      }
      match = pattern.exec(content);
    }
  }
  return found;
};

const classNamePatterns = [
  /className\s*=\s*"([^"$]+)"/g,
  /className\s*=\s*'([^'$]+)'/g,
  /className\s*=\s*\{\s*['"]([^'"]+)['"]\s*\}/g,
  // 模板字符串首段：className={`app-main ${cond ? 'x' : ''}`} → 取反引号内到首个 ${ 之前的字面量。
  /className\s*=\s*\{`([^`$]+)/g,
  // cn('foo', cond && 'is-active') first literal — B3 helper hides classes from className=.
  /\bcn\(\s*['"]([^'"]+)['"]/g,
];

const testIdPatterns = [
  /data-testid\s*=\s*"([^"]+)"/g,
  /data-testid\s*=\s*'([^']+)'/g,
  /data-testid\s*=\s*\{`([^`]+)`\}/g,
  /data-testid\s*=\s*\{\s*['"]([^'"]+)['"]\s*\}/g,
  /dataTestId\s*=\s*"([^"]+)"/g,
  /dataTestId\s*=\s*'([^']+)'/g,
];

const classNames = new Set();
const testIds = new Set();

for (const filePath of walkTsx(rendererRoot)) {
  const content = fs.readFileSync(filePath, 'utf8');
  for (const name of extractFromStringLiteral(content, classNamePatterns)) {
    classNames.add(name);
  }
  for (const id of extractFromStringLiteral(content, testIdPatterns)) {
    testIds.add(id);
  }
}

// ResizeHandle has a closed side union and renders both its class and test id
// from that value. Keep the two concrete class contracts only while the
// implementation remains finite and its SSR test asserts each variant.
const resizeHandleSource = fs.readFileSync(path.join(rendererRoot, 'shell', 'ResizeHandle.tsx'), 'utf8');
const resizeHandleTest = fs.readFileSync(path.join(rendererRoot, 'shell', 'ResizeHandle.test.ts'), 'utf8');
const hasFiniteResizeSides = resizeHandleSource.includes("export type ResizeHandleSide = 'left' | 'right';")
  && resizeHandleSource.includes('panel-resize-handle-${side}');
for (const side of ['left', 'right']) {
  const className = `panel-resize-handle-${side}`;
  const testAssertsId = resizeHandleTest.includes(`expect(markup).toContain('data-testid="${className}"')`);
  const testAssertsClass = resizeHandleTest.includes(`expect(markup).toContain('${className}`);
  if (hasFiniteResizeSides && testAssertsId && testAssertsClass) {
    classNames.add(className);
  }
}

fs.mkdirSync(outDir, { recursive: true });

const classOut = path.join(outDir, 'fidelity-classnames.txt');
const testOut = path.join(outDir, 'fidelity-testids.txt');

const sortedClasses = [...classNames].sort((a, b) => a.localeCompare(b));
const sortedTestIds = [...testIds].sort((a, b) => a.localeCompare(b));

fs.writeFileSync(classOut, `${sortedClasses.join('\n')}\n`, 'utf8');
fs.writeFileSync(testOut, `${sortedTestIds.join('\n')}\n`, 'utf8');

console.log(`[fidelity:extract] class names: ${sortedClasses.length} -> ${path.relative(repoRoot, classOut)}`);
console.log(`[fidelity:extract] test ids: ${sortedTestIds.length} -> ${path.relative(repoRoot, testOut)}`);
