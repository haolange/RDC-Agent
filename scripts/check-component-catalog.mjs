import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const catalog = 'designs/rdc-agent-design-system';
const parse = file => ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : /\.tsx?$/.test(file) && !/\.test\./.test(file) ? [file] : [];
  });
}
const publicNames = new Set();
for (const statement of parse('src/renderer/ui/index.ts').statements) {
  if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
    for (const symbol of statement.exportClause.elements) {
      if (!symbol.isTypeOnly && !statement.isTypeOnly) publicNames.add(symbol.name.text);
    }
  }
}
publicNames.add('HelpTip');
publicNames.add('TaskStatusMarker');
const consumers = new Map([...publicNames].map(name => [name, []]));
for (const file of files('src/renderer')) {
  for (const statement of parse(file).statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const bindings = statement.importClause?.namedBindings;
    const target = path.resolve(path.dirname(file), specifier);
    if (!target.startsWith(path.join(root, 'src/renderer/ui')) || statement.importClause?.isTypeOnly) continue;
    const defaultName = path.basename(target).replace(/\.tsx?$/, '');
    if (statement.importClause?.name && consumers.has(defaultName)) consumers.get(defaultName).push(file.replaceAll('\\', '/'));
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const symbol of bindings.elements) {
      const name = (symbol.propertyName ?? symbol.name).text;
      if (!symbol.isTypeOnly && consumers.has(name)) consumers.get(name).push(file.replaceAll('\\', '/'));
    }
  }
}
const rows = [...consumers].sort(([a], [b]) => a.localeCompare(b)).map(([name, paths]) =>
  `| ${name} | ${[...new Set(paths)].sort().map(file => `\`${file.replace('src/renderer/', '')}\``).join('<br>') || '无直接消费者：检查公开入口是否仍有用途'} |`);
const output = '# 生产组件消费者索引\n\n由 `node scripts/check-component-catalog.mjs --write` 从生产 TypeScript import 生成。路径相对 src/renderer；包含 UI 内部组合消费者，排除测试和活文档。该索引证明引用关系，不代替运行验收。\n\n| 组件 | 直接消费者 |\n|---|---|\n' + rows.join('\n') + '\n';
const destination = `${catalog}/consumers.md`;
if (process.argv.includes('--write')) fs.writeFileSync(destination, output);
else if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8').replaceAll('\r\n', '\n') !== output) {
  throw new Error('组件消费者索引过期；运行 node scripts/check-component-catalog.mjs --write 并复核差异。');
}
for (const file of files(catalog)) {
  const source = fs.readFileSync(file, 'utf8');
  if (/window\.electronAPI|getElectronApi\s*\(|\bfetch\s*\(/.test(source)) {
    throw new Error(`活文档不得访问真实配置或网络：${file}`);
  }
}
console.log(`check:component-catalog passed (${publicNames.size} public components)`);
